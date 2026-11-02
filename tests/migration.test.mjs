import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'cheerio';
const linker = vi.hoisted(() => ({ failTarget: undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		link: async (from, to) => {
			if (linker.failTarget && to.endsWith(linker.failTarget)) {
				linker.failTarget = undefined;
				throw new Error('simulated commit failure');
			}
			return original.link(from, to);
		},
	};
});
import {
	planMigration,
	applyMigration,
	rollbackMigration,
	loadProject,
	parse_data,
	generate_html,
	replace_placeholders,
} from '../src/index.ts';
import { migrationHash, migrationInventory } from '../src/migration.ts';
import {
	applyPatches,
	figureMarkdown,
	markdownPatches,
	migrationHeader,
} from '../src/migration_markdown.ts';
import { stylesheetPatches } from '../src/migration_templates.ts';
import { projectFixture } from './helpers.mjs';
import { headingMarkdown } from '../src/markdown.ts';
import { pruneMigrationSources } from '../src/migration_journal.ts';

let fixture, journalParent, moves;
const write = async (path, text) => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text);
};
const changes = (plan) => plan.issues.filter((item) => item.severity === 'error');
const contents = (plan, source) =>
	plan.operations.find((operation) => operation.source === source).contents;
const journal = () => join(journalParent, 'rollback');
async function map() {
	const inputs = await migrationInventory(fixture.project);
	return inputs.map((input) => ({
		source: input.path,
		sha256: input.sha256,
		...(input.path === 'data/categories.json'
			? { target: 'publishing/categories.json' }
			: input.path.startsWith('data/')
				? {
						target: input.path
							.replace(/^data\//, 'notes/')
							.replace('/misc/', '/reference/')
							.replace('/TODO/', '/investigations/'),
					}
				: input.path === 'templates/index.html'
					? { target: 'publishing/layout.html' }
					: input.path.startsWith('templates/') && !input.path.endsWith('.css')
						? { target: input.path.replace(/^templates\//, 'publishing/themes/') }
						: input.path.startsWith('resources/')
							? { target: input.path.replace(/^resources\//, 'attachments/') }
							: {}),
	}));
}
beforeEach(async () => {
	fixture = await projectFixture();
	journalParent = await mkdtemp(join(tmpdir(), 'cross-doc-migration-journals-'));
	linker.failTarget = undefined;
	moves = await map();
});
afterEach(async () => {
	await fixture.cleanup();
	await rm(journalParent, { recursive: true, force: true });
});
const plan = () => planMigration({ project: fixture.project, moves });

it('plans a complete migration without writes and removes only the figures frontmatter range', async () => {
	const before = await migrationInventory(fixture.project);
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(await migrationInventory(fixture.project)).toEqual(before);
	const source = await readFile(join(fixture.project, 'data/alice.md'), 'utf8');
	const header = migrationHeader(source);
	const converted = contents(result, 'data/alice.md');
	expect(converted.slice(0, migrationHeader(converted).bodyStart)).toBe(
		source.slice(0, header.figuresRange[0]) +
			source.slice(header.figuresRange[1], header.bodyStart),
	);
	expect(converted).toContain('[Bob](bob.md)');
	expect(converted).toMatch(
		/!\[The expedition map\]\(<\.\.\/attachments\/map.svg> "The expedition map"\)\n$/,
	);
	expect(result.legacyLinks.figures).toEqual([
		{ legacyId: 'figure-alice', target: 'notes/alice', ordinal: 1 },
	]);
	expect(result.idMap.alice).toBe('entry/notes/alice');
});

it('plans and applies inline reference expansion with checked rollback', async () => {
	const path = join(fixture.project, 'data/alice.md');
	const original =
		(await readFile(path, 'utf8')) + '\n[father][1] and [again][1].\n\n[1]: #bob "Father"\n';
	await write(path, original);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(contents(result, 'data/alice.md')).toContain(
		'[father](<bob.md> "Father") and [again](<bob.md> "Father")',
	);
	expect(contents(result, 'data/alice.md')).not.toContain('[1]:');
	await applyMigration(result, { journalDirectory: journal() });
	const migrated = await loadProject({ project: fixture.project });
	const $ = load(migrated.entries.find((entry) => entry.slug === 'notes/alice').html);
	expect(
		$('a')
			.filter((_, a) => $(a).text() === 'father')
			.attr('href'),
	).toBe('#entry/notes/bob');
	expect((await plan()).operations).toEqual([]);
	await rollbackMigration(journal());
	expect(await readFile(path, 'utf8')).toBe(original);
});

it('applies, validates, repeats as an empty plan, and rolls back every original byte and mode', async () => {
	await chmod(join(fixture.project, 'data/alice.md'), 0o640);
	moves = await map();
	const before = await migrationInventory(fixture.project);
	const result = await plan();
	const applied = await applyMigration(JSON.parse(JSON.stringify(result)), {
		journalDirectory: journal(),
	});
	expect(applied.status).toBe('applied');
	const migrated = await loadProject({ project: fixture.project });
	expect(migrated.entries).toHaveLength(4);
	const $ = load(migrated.entries.find((entry) => entry.slug === 'notes/alice').html);
	expect($('figure')).toHaveLength(1);
	expect($('figure').attr('id')).toBe('figure/notes/alice/1');
	const again = await plan();
	expect(again.alreadyMigrated).toBe(true);
	expect(again.operations).toEqual([]);
	expect(changes(again)).toEqual([]);
	await rollbackMigration(journal());
	expect(await migrationInventory(fixture.project)).toEqual(before);
	await expect(lstat(join(fixture.project, 'notes'))).rejects.toMatchObject({ code: 'ENOENT' });
	expect((await lstat(join(fixture.project, 'data/alice.md'))).mode & 0o777).toBe(0o640);
	await expect(rollbackMigration(journal())).resolves.toMatchObject({ status: 'rolled-back' });
});

it('removes empty source ancestors while retaining files and supports rollback', async () => {
	const source = join(fixture.project, 'data/nested/deeper/extra.md');
	await write(source, '---\ntitle: Extra\ntype: person\n---\n# Extra\n');
	await write(join(fixture.project, 'resources/retained.txt'), 'Do not delete');
	moves = await map();
	// Explicitly retain this resource to exercise nonempty legacy roots.
	delete moves.find((m) => m.source === 'resources/retained.txt').target;
	const result = await plan();
	expect(changes(result)).toEqual([]);
	await applyMigration(result, { journalDirectory: journal() });
	await expect(lstat(join(fixture.project, 'data'))).rejects.toMatchObject({ code: 'ENOENT' });
	await expect(lstat(join(fixture.project, 'templates'))).rejects.toMatchObject({ code: 'ENOENT' });
	expect(await readFile(join(fixture.project, 'resources/retained.txt'), 'utf8')).toBe(
		'Do not delete',
	);
	expect(await pruneMigrationSources(result)).toEqual([]);
	await rollbackMigration(journal());
	expect(await readFile(source, 'utf8')).toContain('# Extra');
	expect(await readFile(join(fixture.project, 'resources/retained.txt'), 'utf8')).toBe(
		'Do not delete',
	);
});

it('refuses symlinked source directories during empty-folder cleanup', async () => {
	const result = await plan();
	await mkdir(join(fixture.project, 'external'));
	await symlink(join(fixture.project, 'external'), join(fixture.project, 'redirect'));
	result.operations = [{ source: 'redirect/entry.md' }];
	await expect(pruneMigrationSources(result)).rejects.toThrow('symlink');
	expect((await lstat(join(fixture.project, 'external'))).isDirectory()).toBe(true);
});

it('automatically rolls back a failure after earlier files were committed', async () => {
	const before = await migrationInventory(fixture.project);
	const result = await plan();
	linker.failTarget = 'notes/bob.md';
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'automatic rollback completed',
	);
	expect(await migrationInventory(fixture.project)).toEqual(before);
	expect(JSON.parse(await readFile(join(journal(), 'journal.json'), 'utf8')).status).toBe(
		'rolled-back',
	);
	await expect(lstat(join(fixture.project, 'notes'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses stale source hashes and newly added inputs before creating a journal', async () => {
	const result = await plan();
	await write(join(fixture.project, 'data/bob.md'), 'changed');
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'changed since planning',
	);
	await expect(lstat(journal())).rejects.toMatchObject({ code: 'ENOENT' });
	expect(changes(await plan()).some((item) => item.code === 'stale-source')).toBe(true);
});

it('refuses occupied or raced-in destinations', async () => {
	const result = await plan();
	await write(join(fixture.project, 'notes/bob.md'), 'keep');
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'target appeared',
	);
	expect(await readFile(join(fixture.project, 'notes/bob.md'), 'utf8')).toBe('keep');
	expect(changes(await plan()).some((item) => item.code === 'occupied-target')).toBe(true);
});

it('refuses rollback conflicts without clobbering edited notes or restoring any other source', async () => {
	const result = await plan();
	await applyMigration(result, { journalDirectory: journal() });
	await write(join(fixture.project, 'notes/bob.md'), 'user edit');
	await expect(rollbackMigration(journal())).rejects.toThrow('Rollback conflict');
	expect(await readFile(join(fixture.project, 'notes/bob.md'), 'utf8')).toBe('user edit');
	await expect(lstat(join(fixture.project, 'data/alice.md'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
	await write(join(fixture.project, 'notes/bob.md'), contents(result, 'data/bob.md'));
	await rollbackMigration(journal());
});

it('refuses corrupt rollback backups when the original is absent', async () => {
	await applyMigration(await plan(), { journalDirectory: journal() });
	await write(join(journal(), 'originals/0.bin'), 'corrupt');
	await expect(rollbackMigration(journal())).rejects.toThrow('backup missing or corrupt');
});

it.each(['../escape.md', '/absolute.md', 'notes/../escape.md', '.obsidian/config.md'])(
	'rejects unsafe target %s',
	async (target) => {
		moves[0].target = target;
		await expect(plan()).rejects.toThrow();
	},
);

it('rejects input and destination symlinks', async () => {
	await symlink(join(fixture.project, 'data'), join(fixture.project, 'notes'));
	const result = await plan();
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		/symlink|blocking/,
	);
	await rm(join(fixture.project, 'notes'));
	await symlink(join(fixture.project, 'data/bob.md'), join(fixture.project, 'resources/alias.md'));
	await expect(plan()).rejects.toThrow('symlinks require review');
});

it('keeps journals outside the vault and refuses an existing journal destination', async () => {
	const result = await plan();
	await expect(
		applyMigration(result, { journalDirectory: join(fixture.project, 'migration') }),
	).rejects.toThrow('outside the project');
	await mkdir(journal());
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'already exists',
	);
});

it('rejects incomplete and portable-colliding move maps and ambiguous basenames', async () => {
	moves = moves.slice(1);
	expect(changes(await plan()).some((item) => item.code === 'uninventoried-source')).toBe(true);
	moves = await map();
	moves.find((row) => row.source === 'data/bob.md').target = 'notes/ALICE.md';
	expect(changes(await plan()).some((item) => item.code === 'path-collision')).toBe(true);
	await write(
		join(fixture.project, 'data/history/alice.md'),
		'---\ntitle: Alice\ntype: person\n---\n# Alice',
	);
	moves = await map();
	expect(changes(await plan()).some((item) => item.code === 'duplicate-slug')).toBe(true);
});

it('preserves code and labels while expanding reference links into inline file links', () => {
	const text =
		'`[literal](#bob)`\n\n```md\n[code](#bob)\n```\n\n[**Bob**](#bob "unchanged title") and [reference][b].\n\n[b]: <#bob> \'Reference title\'\n\n- [multi\n  line](#bob)\n\n> [quoted](#bob)\n\n| Header |\n| --- |\n| [table](#bob) |\n';
	const patches = markdownPatches(text, 'data/a.md', 'notes/a.md', (value) =>
		value === '#bob' ? 'bob.md' : value,
	);
	const actual = applyPatches(text, patches);
	expect(patches).toHaveLength(7);
	expect(actual).toContain('`[literal](#bob)`');
	expect(actual).toContain('[code](#bob)');
	expect(actual).toContain('[**Bob**](bob.md "unchanged title")');
	expect(actual).toContain('[reference](<bob.md> "Reference title")');
	expect(actual).not.toContain('[b]:');
	expect(actual).toContain('- [multi line](bob.md)');
	expect(actual).toContain('> [quoted](bob.md)');
	expect(actual).toContain('| [table](bob.md) |');
});

it('expands full, collapsed, shortcut, reused and image references losslessly', () => {
	const text =
		'[**father**][One] and [again][one] and [collapsed][] and [shortcut].\n\n![map][image]\n\n[One]: <#bob> "A &amp; B &quot;quoted&quot;"\n[collapsed]: #bob\n[shortcut]: #bob\n[image]: <map.png> "The map"\n[unused]: https://example.org\n';
	const rewrite = (value) => (value === '#bob' ? 'bob.md' : value);
	const actual = applyPatches(text, markdownPatches(text, 'data/a.md', 'notes/a.md', rewrite));
	expect(actual).toContain('[**father**](<bob.md>');
	expect(actual).toContain('[again](<bob.md>');
	expect(actual).toContain('[collapsed](<bob.md>)');
	expect(actual).toContain('[shortcut](<bob.md>)');
	expect(actual).toContain('![map](<map.png> "The map")');
	expect(actual).not.toMatch(/\[(?:One|collapsed|shortcut|image)\]:/);
	expect(actual).toContain('[unused]: https://example.org');
	const before = load(headingMarkdown.parse(text));
	const after = load(headingMarkdown.parse(actual));
	expect(
		after('a')
			.map((_, a) => [after(a).text(), after(a).attr('title')])
			.get(),
	).toEqual(
		before('a')
			.map((_, a) => [before(a).text(), before(a).attr('title')])
			.get(),
	);
	expect(
		after('a')
			.map((_, a) => after(a).attr('href'))
			.get(),
	).toEqual(['bob.md', 'bob.md', 'bob.md', 'bob.md']);
	expect(after('img').attr('title')).toBe(before('img').attr('title'));
	expect(markdownPatches(actual, 'notes/a.md', 'notes/a.md', (value) => value)).toEqual([]);
});

it('preserves CRLF, nested labels, containers, tables and literal reference examples', () => {
	const text =
		'> [**father**][1]\r\n>\r\n> [1]: #bob "Father"\r\n\r\n- [another][2]\r\n\r\n| Header |\r\n| --- |\r\n| [table][2] |\r\n\r\n[2]: #bob\r\n\r\n`[literal][1]` and \\[escaped]\\[1] and [missing][nope]\r\n\r\n```md\r\n[code][1]\r\n[1]: #bob\r\n```\r\n';
	const actual = applyPatches(
		text,
		markdownPatches(text, 'data/a.md', 'notes/a.md', (value) =>
			value === '#bob' ? 'bob.md' : value,
		),
	);
	expect(actual).toContain('> [**father**](<bob.md> "Father")\r\n');
	expect(actual).toContain('- [another](<bob.md>)\r\n');
	expect(actual).toContain('| [table](<bob.md>) |\r\n');
	expect(actual).toContain('`[literal][1]` and \\[escaped]\\[1] and [missing][nope]');
	expect(actual).toContain('```md\r\n[code][1]\r\n[1]: #bob\r\n```');
	expect(actual.replaceAll('\r\n', '')).not.toContain('\n');
});

it('joins wrapped inline and reference labels without reflowing prose or code', () => {
	const text =
		'It lived in a [puzzle\nbox](#bob).\n\nHe [woke in Paris after a night of\nheavy drinking](#bob), and joined [Société du Cinéma Secrètement\nParisien][1].\n\n[1]: #bob\n\nUnrelated\nprose. `[code\nspan](#bob)`\n\n```md\n[puzzle\nbox](#bob)\n```\n';
	const actual = applyPatches(
		text,
		markdownPatches(text, 'data/a.md', 'notes/a.md', (v) => (v === '#bob' ? 'bob.md' : v)),
	);
	expect(actual).toContain('[puzzle box](bob.md)');
	expect(actual).toContain('[woke in Paris after a night of heavy drinking](bob.md)');
	expect(actual).toContain('[Société du Cinéma Secrètement Parisien](<bob.md>)');
	expect(actual).toContain('Unrelated\nprose. `[code\nspan](#bob)`');
	expect(actual).toContain('```md\n[puzzle\nbox](#bob)\n```');
	const before = load(headingMarkdown.parse(text));
	const after = load(headingMarkdown.parse(actual));
	expect(
		after('a')
			.map((_, a) => after(a).text())
			.get(),
	).toEqual(
		before('a')
			.map((_, a) =>
				before(a)
					.text()
					.replace(/\s*\n\s*/g, ' '),
			)
			.get(),
	);
	expect(markdownPatches(actual, 'notes/a.md', 'notes/a.md', (v) => v)).toEqual([]);
});

it('joins wrapped labels across CRLF container prefixes and nested images', () => {
	const text = '> [puzzle\r\n> box](#bob)\r\n\r\n- [![a\r\n  map](map.png)](#bob)\r\n';
	const actual = applyPatches(
		text,
		markdownPatches(text, 'data/a.md', 'notes/a.md', (v) => (v === '#bob' ? 'bob.md' : v)),
	);
	expect(actual).toBe('> [puzzle box](bob.md)\r\n\r\n- [![a map](map.png)](bob.md)\r\n');
});

it('keeps CRLF/BOM, unrelated YAML comments, nested values and null/empty custom fields byte-identical', async () => {
	const text =
		'\uFEFF---\r\ntitle: Alice # title comment\r\ntype: person\r\ncustom: {empty: [], nullable: null, text: "[not a link](#bob)"}\r\nfigures:\r\n - file: map.svg\r\n   caption: Map\r\n# owned by next key\r\nalso: [bob]\r\n---\r\n# Alice\r\n\r\n[Bob](#bob)\r\n';
	await write(join(fixture.project, 'data/alice.md'), text);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	const changed = contents(result, 'data/alice.md');
	expect(changed.startsWith('\uFEFF---\r\n')).toBe(true);
	expect(changed).toContain('custom: {empty: [], nullable: null, text: "[not a link](#bob)"}\r\n');
	expect(changed).toContain('# owned by next key\r\nalso: [bob]\r\n');
	expect(changed).not.toMatch(/(?<!\r)\n/);
});

it.each(['figures: null\n', 'figures: []\n'])(
	'removes %s without appending images',
	async (figures) => {
		const text = `---\ntitle: Alice\ntype: person\n${figures}---\n# Alice\n`;
		await write(join(fixture.project, 'data/alice.md'), text);
		moves = await map();
		const result = await plan();
		expect(changes(result)).toEqual([]);
		expect(contents(result, 'data/alice.md')).toBe(
			'---\ntitle: Alice\ntype: person\n---\n# Alice\n',
		);
		expect(result.figures).toEqual([]);
	},
);

it.each([
	'A "quote", apostrophe\'s & <literal> [bracket] \\ path',
	'First line\nsecond line',
	'Greek Αθηνά — figure',
])('round-trips figure caption %s exactly', (caption) => {
	const text = figureMarkdown('../attachments/file%20name.svg', caption, '\n');
	const [entry] = parse_data([
		{
			path: 'example.md',
			contents: `---\ntitle: Caption\ntype: person\n---\n# Caption\n\n${text}`,
		},
	]);
	const $ = load(entry.html);
	expect($('img').attr('title')).toBe(caption);
	expect($('img').attr('alt')).toBe(caption);
	expect(text).toContain('file%20name.svg');
});

it.each([
	'figures: # unclear ownership\n - file: map.svg\n   caption: Map\n',
	'figures:\n - file: map.svg\n   caption: Map # caption comment\n',
	'figures: &shared []\n',
	'figures: [{file: map.svg}]\n',
])('blocks ambiguous or malformed figures: %s', async (yaml) => {
	await write(
		join(fixture.project, 'data/alice.md'),
		`---\ntitle: Alice\ntype: person\n${yaml}---\n# Alice\n`,
	);
	moves = await map();
	expect(changes(await plan()).length).toBeGreaterThan(0);
});

it('appends every figure once after reference definitions, preserving order and reusing bytes', async () => {
	await write(
		join(fixture.project, 'data/alice.md'),
		'---\ntitle: Alice\ntype: person\nfigures:\n - file: map.svg\n   caption: First\n - file: map.svg\n   caption: Second\n---\n# Alice\n\n[Bob][b]\n\n[b]: #bob\n',
	);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	const changed = contents(result, 'data/alice.md');
	expect(changed.indexOf('[b]: bob.md')).toBeLessThan(changed.indexOf('![First]'));
	expect(changed.indexOf('![First]')).toBeLessThan(changed.indexOf('![Second]'));
	expect(result.legacyLinks.figures.map((figure) => figure.ordinal)).toEqual([1, 2]);
	await applyMigration(result, { journalDirectory: journal() });
	const $ = load(
		(await loadProject({ project: fixture.project })).entries.find(
			(entry) => entry.slug === 'notes/alice',
		).html,
	);
	expect($('figure')).toHaveLength(2);
	expect(migrationHash(await readFile(join(fixture.project, 'attachments/map.svg')))).toBe(
		moves.find((row) => row.source === 'resources/map.svg').sha256,
	);
});

it.each([
	'[Missing](#not-found)',
	'[Figure](#figure-alice)',
	'[[bob]]',
	'[Heading](bob.md#History)',
])('blocks unresolved or manually reviewed body syntax: %s', async (body) => {
	await write(
		join(fixture.project, 'data/alice.md'),
		`---\ntitle: Alice\ntype: person\n---\n# Alice\n\n${body}`,
	);
	moves = await map();
	const result = await plan();
	expect(changes(result).length).toBeGreaterThan(0);
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'blocking errors',
	);
});

it('rewrites HTML link/image attributes without reserializing labels, code or unrelated markup', async () => {
	await write(
		join(fixture.project, 'data/alice.md'),
		'---\ntitle: Alice\ntype: person\n---\n# Alice\n\n<a class=example href="#bob"><em>Bob</em></a> <img alt="Map" src="../resources/map.svg">\n\n`<a href="#bob">Code</a>`',
	);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(contents(result, 'data/alice.md')).toContain(
		'<a class=example href="bob.md"><em>Bob</em></a> <img alt="Map" src="../attachments/map.svg">',
	);
	expect(contents(result, 'data/alice.md')).toContain('`<a href="#bob">Code</a>`');
});

it('rewrites only real category selectors and preserves stylesheet comments and string literals', () => {
	const source =
		'#event .entry, #person header { color: #abc; content: "#event"; background:url("#event"); } /* #event {} */';
	const patches = stylesheetPatches(
		source,
		'templates/default/index.scss',
		'publishing/themes/default/index.scss',
		(value) => value,
		['event', 'person'],
	);
	expect(applyPatches(source, patches)).toBe(
		'[data-category="event"] .entry, [data-category="person"] header { color: #abc; content: "#event"; background:url("#event"); } /* #event {} */',
	);
});

it('uses the entry title for see-also labels after migrating a note with several H1 headings', async () => {
	await write(
		join(fixture.project, 'data/bob.md'),
		'---\ntitle: Bob\ntype: person\nalso: [alice]\n---\n# Bob\n\n# Workshop\n\n[Alice](#alice)',
	);
	moves = await map();
	await applyMigration(await plan(), { journalDirectory: journal() });
	const loaded = await loadProject({ project: fixture.project });
	const $ = await generate_html(loaded.entries, {
		project: fixture.project,
		theme: 'default',
		css_file_name: join(journalParent, 'out.css'),
	});
	replace_placeholders($);
	expect($('[id="entry/notes/alice"] .see-also a').text()).toBe('Bob');
	expect($('[id="entry/notes/bob"] > h2').text()).toBe('Workshop');
	const selected = await loadProject({ project: fixture.project, include: ['notes/bob'] });
	expect(load(selected.entries[0].html)('div.see-also')).toHaveLength(0);
});

it('keeps existing inline figures in place and appends only metadata replacements with stable ordinals', async () => {
	const source = await readFile(join(fixture.project, 'data/alice.md'), 'utf8');
	await write(
		join(fixture.project, 'data/alice.md'),
		`${source}\n![Existing](../resources/map.svg "Existing figure")\n`,
	);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(result.figures).toHaveLength(1);
	expect(result.figures[0].ordinal).toBe(2);
	expect(result.legacyLinks.figures.map((figure) => figure.ordinal)).toEqual([1, 2]);
	await applyMigration(result, { journalDirectory: journal() });
	const entry = (await loadProject({ project: fixture.project })).entries.find(
		(entry) => entry.slug === 'notes/alice',
	);
	const $ = load(entry.html);
	expect($('figure')).toHaveLength(2);
	expect(
		$('figcaption')
			.map((_i, node) => $(node).text())
			.get(),
	).toEqual(['fig. figcount Existing figure', 'fig. figcount The expedition map']);
});

it('preserves opaque editable-package bytes and retains unreferenced files for review', async () => {
	const bytes = Buffer.from([0, 255, 254, 128, 13, 10]);
	await write(join(fixture.project, 'resources/design.pxd/data/blob'), bytes);
	await write(join(fixture.project, 'resources/unused.png'), bytes);
	moves = await map();
	moves.find((row) => row.source === 'resources/design.pxd/data/blob').target =
		'artwork/sources/design.pxd/data/blob';
	const retained = moves.find((row) => row.source === 'resources/unused.png');
	delete retained.target;
	retained.review = 'Keep unreferenced bytes pending review';
	const result = await plan();
	expect(changes(result)).toEqual([]);
	await applyMigration(result, { journalDirectory: journal() });
	expect(await readFile(join(fixture.project, 'artwork/sources/design.pxd/data/blob'))).toEqual(
		bytes,
	);
	expect(await readFile(join(fixture.project, 'resources/unused.png'))).toEqual(bytes);
	await rollbackMigration(journal());
	expect(await readFile(join(fixture.project, 'resources/design.pxd/data/blob'))).toEqual(bytes);
});

it('rewrites Sass/CSS asset paths while preserving module imports and line comments', async () => {
	await write(
		join(fixture.project, 'templates/default/index.scss'),
		'@use "sass:math";\n@use "parts/images";\n@import "extra.css";\n// url("missing.png")\nbody {color:black;}',
	);
	await write(
		join(fixture.project, 'templates/default/parts/_images.scss'),
		'.image {background:url("../../../resources/map.svg")}',
	);
	await write(
		join(fixture.project, 'templates/default/extra.css'),
		'.other {background:url("../../resources/map.svg")}',
	);
	moves = await map();
	moves.find((row) => row.source === 'templates/default/extra.css').target =
		'publishing/themes/default/extra.css';
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(contents(result, 'templates/default/index.scss')).toContain('// url("missing.png")');
	expect(contents(result, 'templates/default/index.scss')).toContain('@use "parts/images"');
	expect(contents(result, 'templates/default/parts/_images.scss')).toContain(
		'../../../../attachments/map.svg',
	);
	expect(contents(result, 'templates/default/extra.css')).toContain('../../../attachments/map.svg');
	await applyMigration(result, { journalDirectory: journal() });
	await generate_html((await loadProject({ project: fixture.project })).entries, {
		project: fixture.project,
		theme: 'default',
		css_file_name: join(journalParent, 'out.css'),
	});
	expect(await readFile(join(journalParent, 'out.css'), 'utf8')).toContain(
		'data:image/svg+xml;base64,',
	);
});

it('blocks stylesheet and SVG dependency cycles before application', async () => {
	await write(join(fixture.project, 'templates/default/_one.scss'), '@use "two";');
	await write(join(fixture.project, 'templates/default/_two.scss'), '@use "one";');
	await write(join(fixture.project, 'resources/one.svg'), '<svg><use href="two.svg#shape"/></svg>');
	await write(join(fixture.project, 'resources/two.svg'), '<svg><use href="one.svg#shape"/></svg>');
	moves = await map();
	const result = await plan();
	expect(changes(result).filter((issue) => issue.code === 'dependency-cycle')).toHaveLength(2);
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'blocking errors',
	);
});

it('blocks missing SVG style dependencies and byte-changing resource rewrites', async () => {
	await write(
		join(fixture.project, 'resources/missing.svg'),
		'<svg><style>.paint {fill:url("absent.svg#shape")}</style></svg>',
	);
	await write(
		join(fixture.project, 'resources/nested/flattened.svg'),
		'<svg><image href="../map.svg"/></svg>',
	);
	moves = await map();
	moves.find((row) => row.source === 'resources/nested/flattened.svg').target =
		'attachments/flattened.svg';
	const result = await plan();
	expect(changes(result).some((issue) => issue.code === 'missing-dependency')).toBe(true);
	expect(changes(result).some((issue) => issue.message.includes('change attachment bytes'))).toBe(
		true,
	);
});

it('blocks unresolved relationship metadata even when no body link uses it', async () => {
	await write(
		join(fixture.project, 'data/bob.md'),
		'---\ntitle: Bob\ntype: person\nalso: [missing]\n---\n# Bob',
	);
	moves = await map();
	expect(changes(await plan()).some((issue) => issue.code === 'missing-metadata-target')).toBe(
		true,
	);
});

it('blocks required-layout mismatches and collisions with generated configuration', async () => {
	moves.find((row) => row.source === 'data/categories.json').target = 'publishing/wrong.json';
	moves.find((row) => row.source === 'resources/map.svg').target = 'publishing/project.json';
	const result = await plan();
	expect(changes(result).some((issue) => issue.code === 'layout-contract')).toBe(true);
	expect(changes(result).some((issue) => issue.code === 'path-collision')).toBe(true);
});

it('rejects captions that cannot be serialized losslessly instead of flattening them', () => {
	expect(() => figureMarkdown('../attachments/map.svg', 'First\n\nsecond', '\n')).toThrow(
		'cannot round-trip losslessly',
	);
});

it('blocks raw HTML figures whose source IDs cannot become automatic inline figure ordinals', async () => {
	const text = await readFile(join(fixture.project, 'data/alice.md'), 'utf8');
	await write(
		join(fixture.project, 'data/alice.md'),
		`${text}\n<figure id="figure-manual"><img src="../resources/map.svg"><figcaption>Manual</figcaption></figure>\n`,
	);
	moves = await map();
	const result = await plan();
	expect(changes(result).some((issue) => issue.message.includes('raw HTML figures'))).toBe(true);
	await expect(applyMigration(result, { journalDirectory: journal() })).rejects.toThrow(
		'blocking errors',
	);
});

it('rewrites source-relative body and layout style URLs while preserving surrounding HTML', async () => {
	const source = await readFile(join(fixture.project, 'data/alice.md'), 'utf8');
	await write(
		join(fixture.project, 'data/alice.md'),
		`${source}\n<p class=paint style='background:url("../resources/map.svg")'>Styled</p>\n`,
	);
	const layout = await readFile(join(fixture.project, 'templates/index.html'), 'utf8');
	await write(
		join(fixture.project, 'templates/index.html'),
		layout.replace(
			'</head>',
			'<style>.logo {background:url("../resources/map.svg")}</style></head>',
		),
	);
	moves = await map();
	const result = await plan();
	expect(changes(result)).toEqual([]);
	expect(contents(result, 'data/alice.md')).toContain(
		"<p class=paint style='background:url(&quot;../attachments/map.svg&quot;)'>Styled</p>",
	);
	expect(contents(result, 'templates/index.html')).toContain(
		'background:url("../attachments/map.svg")',
	);
	await applyMigration(result, { journalDirectory: journal() });
	const $ = await generate_html((await loadProject({ project: fixture.project })).entries, {
		project: fixture.project,
		theme: 'default',
		css_file_name: join(journalParent, 'out.css'),
	});
	expect($('.paint').attr('style')).toContain('data:image/svg+xml;base64,');
});

it('does not mistake a partially authored configured vault for a completed migration', async () => {
	await applyMigration(await plan(), { journalDirectory: journal() });
	const path = join(fixture.project, 'notes/bob.md');
	const text = await readFile(path, 'utf8');
	await write(path, text.replace('---\n#', 'figures: null\n---\n#'));
	const result = await plan();
	expect(result.alreadyMigrated).toBe(false);
	expect(
		changes(result).some((issue) => issue.message.includes('Figures frontmatter still exists')),
	).toBe(true);
});
