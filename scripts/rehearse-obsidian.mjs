import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as api from '../dist/index.js';
import { migrationHash, migrationInventory } from '../dist/migration.js';
import { migrationHeader } from '../dist/migration_markdown.js';
import { canonicalDestination } from '../dist/publication_paths.js';
import { within } from '../dist/layout.js';
const exec = promisify(execFile);
const { values } = parseArgs({
	options: {
		project: { type: 'string' },
		moves: { type: 'string' },
		output: { type: 'string' },
		pdf: { type: 'boolean' },
	},
});
if (!values.project || !values.moves || !values.output)
	throw new Error('Use --project PROJECT --moves MAP.json --output NEW_EXTERNAL_DIRECTORY [--pdf]');
const source = resolve(values.project),
	output = resolve(values.output);
if (within(await canonicalDestination(source), await canonicalDestination(output)))
	throw new Error('Rehearsal output must be outside live project');
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const project = join(output, 'project'),
	moves = JSON.parse(await readFile(values.moves, 'utf8'));
const originals = await migrationInventory(source);
const json = async (name, data) => {
	await mkdir(dirname(join(output, name)), { recursive: true });
	await writeFile(join(output, name), `${JSON.stringify(data, null, 2)}\n`);
};
console.log('Copying inventoried files into the disposable project');
for (const input of originals) {
	await mkdir(dirname(join(project, input.path)), { recursive: true });
	await copyFile(join(source, input.path), join(project, input.path));
	await chmod(join(project, input.path), input.mode);
}
const plan = await api.planMigration({ project, moves });
await json('plan.json', plan);
assert.deepEqual(
	plan.issues.filter((item) => item.severity === 'error'),
	[],
	'Dry run has blocking errors',
);
const old = await api.loadProject({ project });
const selection = [
	'mordredii',
	'sam',
	'was',
	'artie',
	'230310-gawain-in-london',
	'2300313-boston',
	'heb-sed-mace',
	'todo-jotunheimr',
	'satt',
];
const oldSelected = await api.loadProject({ project, include: selection });
async function render(loaded, theme, path) {
	const $ = await api.generate_html(loaded.entries, {
		project,
		theme,
		css_file_name: join(output, `${path}.css`),
	});
	api.replace_placeholders($);
	await api.add_table_of_contents($, { project });
	api.add_title_attributes($);
	await writeFile(join(output, `${path}.html`), $.html());
	return $;
}
await mkdir(join(output, 'before'));
const before = await render(old, 'A5', 'before/full-A5');
const beforeSelected = await render(oldSelected, 'A5', 'before/selected-A5');
const oldCss = new Map();
for (const theme of old.themes) {
	const $ = await render(old, theme, `before/${theme}`);
	void $;
	oldCss.set(theme, await readFile(join(output, `before/${theme}.css`), 'utf8'));
}
console.log(
	`Applying ${plan.operations.length} operations; originals remain in the external journal`,
);
await api.applyMigration(plan, { journalDirectory: join(output, 'journal') });
const migrated = await api.loadProject({ project });
const canonical = new Map(
	plan.legacyLinks.entries.map((entry) => [entry.legacySlug, entry.target]),
);
const newSelected = await api.loadProject({
	project,
	include: selection.map((slug) => canonical.get(slug)),
});
await mkdir(join(output, 'after'));
const after = await render(migrated, 'A5', 'after/full-A5');
const afterSelected = await render(newSelected, 'A5', 'after/selected-A5');
const summaries = [];
const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const target = (href, modern) => {
	if (!href?.startsWith('#')) return href;
	const token = href.slice(1);
	if (modern && /^(entry|figure|sheet|category|heading|anchor)\//.test(token))
		return decodeURIComponent(token);
	return plan.idMap[token] ?? plan.idMap[decodeURIComponent(token)] ?? token;
};
function compare(before, after, name) {
	const oldEntries = before('.entry').toArray(),
		newEntries = after('.entry').toArray();
	assert.deepEqual(
		newEntries.map((node) => after(node).attr('id')),
		oldEntries.map((node) => plan.idMap[before(node).attr('id')]),
		`${name}: entry order/identity`,
	);
	const differences = [];
	assert.equal(after('.see-also ul:empty').length, 0, `${name}: empty see-also blocks`);
	for (let i = 0; i < oldEntries.length; i++) {
		const a = before(oldEntries[i]),
			b = after(newEntries[i]);
		const slug = a.attr('id');
		const links = ($, section, modern) =>
			section
				.find('a')
				.not('.figure-link')
				.toArray()
				.map((node) => {
					const link = $(node);
					const destination = target(link.attr('href'), modern);
					return JSON.stringify({
						target: destination,
						label: link.hasClass('see-also') ? '(entry title)' : normalize(link.text()),
					});
				})
				.sort();
		assert.deepEqual(links(after, b, true), links(before, a, false), `${name}: links for ${slug}`);
		for (const link of b.find('.see-also a').toArray()) {
			const id = target(after(link).attr('href'), true);
			const owner = after('[id]').filter((_i, node) => after(node).attr('id') === id);
			assert.equal(
				after(link).text(),
				owner.children('header').find('h2').first().text(),
				`${name}: see-also title ${slug}`,
			);
		}
		const captions = ($, section) =>
			section
				.find('figure')
				.toArray()
				.map((node) => normalize($(node).find('figcaption').text()));
		assert.deepEqual(captions(after, b), captions(before, a), `${name}: figures for ${slug}`);
		assert.deepEqual(
			b
				.find('figure')
				.map((_i, n) => after(n).attr('id'))
				.get(),
			a
				.find('figure')
				.map((_i, n) => plan.idMap[before(n).attr('id')])
				.get(),
			`${name}: figure targets ${slug}`,
		);
		const text = (section) => {
			const clone = section.clone();
			clone.find('header,.aliases,.see-also,figure').remove();
			return normalize(clone.text());
		};
		if (text(a) !== text(b)) differences.push({ slug, before: text(a), after: text(b) });
		const firstAlias = (section) => normalize(section.find('.aliases').first().text());
		assert.equal(firstAlias(a), firstAlias(b), `${name}: alias content ${slug}`);
		assert.equal(
			normalize(a.children('header').first().text()),
			normalize(b.children('header').first().text()),
			`${name}: header metadata ${slug}`,
		);
	}
	assert.deepEqual(
		differences.map((item) => item.slug),
		['artie'],
		`${name}: unexplained body differences`,
	);
	const oldToc = before('#toc a')
		.toArray()
		.map((node) => ({
			target: target(before(node).attr('href'), false),
			label: normalize(before(node).text()),
		}));
	const newToc = after('#toc a')
		.toArray()
		.map((node) => ({
			target: target(after(node).attr('href'), true),
			label: normalize(after(node).text()),
		}));
	assert.deepEqual(newToc, oldToc, `${name}: TOC`);
	const sheets = ($, modern) =>
		$('.character-sheet')
			.toArray()
			.map((node) => ({
				id: modern ? $(node).attr('id') : plan.idMap[$(node).attr('id')],
				text: normalize($(node).text()),
			}));
	assert.deepEqual(sheets(after, true), sheets(before, false), `${name}: character sheets`);
	assert.equal(
		normalize(after('#timeline').text()),
		normalize(before('#timeline').text()),
		`${name}: timeline`,
	);
	const categories = ($, modern) =>
		$('.category')
			.map((_i, node) => (modern ? $(node).attr('data-category') : $(node).attr('id')))
			.get();
	assert.deepEqual(categories(after, true), categories(before, false), `${name}: category order`);
	summaries.push({
		name,
		entries: newEntries.length,
		figures: after('figure').length,
		links: after('.entry a').not('.figure-link').length,
		knownBodyDifferences: differences,
	});
}
compare(before, after, 'full');
compare(beforeSelected, afterSelected, 'selected');
let preservedHeaders = 0,
	removedFigureKeys = 0;
for (const operation of plan.operations.filter(
	(operation) => operation.source?.startsWith('data/') && operation.source.endsWith('.md'),
)) {
	const index = plan.operations.indexOf(operation);
	const oldText = await readFile(join(output, 'journal/originals', `${index}.bin`), 'utf8');
	const newText = await readFile(join(project, operation.target), 'utf8');
	const a = migrationHeader(oldText),
		b = migrationHeader(newText);
	const expected = a.figuresRange
		? oldText.slice(0, a.figuresRange[0]) + oldText.slice(a.figuresRange[1], a.bodyStart)
		: oldText.slice(0, a.bodyStart);
	assert.equal(newText.slice(0, b.bodyStart), expected, `Frontmatter bytes: ${operation.source}`);
	if (a.figuresRange) removedFigureKeys++;
	else preservedHeaders++;
}
for (const figure of plan.figures) {
	assert.equal(
		migrationHash(await readFile(join(project, figure.attachment))),
		originals.find((input) => input.path === figure.file).sha256,
		`Attachment bytes: ${figure.file}`,
	);
}
const themeResults = [];
for (const theme of migrated.themes) {
	await render(migrated, theme, `after/${theme}`);
	const css = await readFile(join(output, `after/${theme}.css`), 'utf8');
	assert.equal(
		css.replace(/\[data-category=["']?([\w-]+)["']?\]/g, '#$1'),
		oldCss.get(theme),
		`Theme CSS except category selectors: ${theme}`,
	);
	themeResults.push(theme);
}
const repeat = await api.planMigration({ project, moves });
assert.equal(repeat.alreadyMigrated, true);
assert.deepEqual(repeat.operations, []);
await json('verification.json', {
	summaries,
	preservedHeaders,
	removedFigureKeys,
	figures: plan.figures.length,
	themes: themeResults,
	diagnostics: {
		before: old.diagnostics.length,
		after: migrated.diagnostics.length,
		compatibility: migrated.diagnostics.filter((d) => d.code === 'legacy-reference').length,
	},
	repeatOperations: 0,
	reviewFlags: plan.issues.filter((issue) => issue.severity === 'review'),
	idMap: plan.idMap,
});
if (values.pdf) {
	const pdfResults = [];
	for (const theme of ['A5', 'reduced']) {
		console.log(`Publishing representative ${theme} PDF from the disposable vault`);
		const directory = join(output, 'pdf', theme);
		await mkdir(directory, { recursive: true });
		const pdf = join(directory, 'representative.pdf');
		await api.publishProject({
			project,
			theme,
			include: selection.map((slug) => canonical.get(slug)),
			outputs: { pdf: { path: pdf }, html: { path: join(directory, 'representative.html') } },
		});
		const { stdout: info } = await exec('pdfinfo', [pdf]);
		await writeFile(join(directory, 'pdfinfo.txt'), info);
		const { stdout: text } = await exec('pdftotext', ['-layout', pdf, '-']);
		await writeFile(join(directory, 'text.txt'), text);
		await exec('pdftoppm', ['-scale-to', '1100', '-png', pdf, join(directory, 'page')]);
		pdfResults.push({
			theme,
			pages: Number(info.match(/Pages:\s+(\d+)/)?.[1]),
			textBytes: Buffer.byteLength(text),
		});
	}
	await json('pdf-verification.json', pdfResults);
}
console.log('Checking rollback, then reapplying the same reviewed plan for inspection');
await api.rollbackMigration(join(output, 'journal'));
assert.deepEqual(
	await migrationInventory(project),
	originals,
	'Rollback restores all original hashes/modes',
);
await api.applyMigration(plan, { journalDirectory: join(output, 'reapplied-journal') });
assert.deepEqual(await migrationInventory(source), originals, 'Live source files remain unchanged');
await json('completion.json', {
	operations: plan.operations.length,
	edits: plan.edits.length,
	frontmatter: { preserved: preservedHeaders, figuresRemoved: removedFigureKeys },
	figures: plan.figures.length,
	rollbackHashesRestored: originals.length,
	liveHashesUnchanged: originals.length,
	migratedProject: project,
	rollbackJournal: join(output, 'reapplied-journal'),
});
console.log(`Rehearsal complete: ${output}`);
