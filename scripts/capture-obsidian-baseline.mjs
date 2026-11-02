// Read-only source capture for the Obsidian conversion. Rendering writes only to a temp copy.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { Marked } from 'marked';
import { compileAsync } from 'sass';
import { parse } from 'yaml';
import * as api from '../dist/index.js';

process.env.TZ = 'UTC';
const libraryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(process.argv[2] ?? join(libraryRoot, '../legends-walk'));
const destination = resolve(
	process.argv[3] ?? join(libraryRoot, 'docs/obsidian-conversion/baseline'),
);
if (destination === project || destination.startsWith(project + sep)) {
	throw new Error('Baseline destination must be outside the source project');
}
const sha = (value) => createHash('sha256').update(value).digest('hex');
const posix = (value) => value.split(sep).join('/');
const rel = (value) => posix(relative(project, value));
const json = async (name, value) =>
	writeFile(join(destination, name), JSON.stringify(value, null, 2) + '\n');
const command = (name, args, cwd) => {
	const result = spawnSync(name, args, { encoding: 'utf8', ...(cwd ? { cwd } : {}) });
	if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
	return (result.stdout || result.stderr).trim();
};
async function filesIn(directory) {
	const result = [];
	for (const item of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, item.name);
		if (item.isSymbolicLink()) throw new Error(`Capture requires explicit symlink review: ${path}`);
		if (item.isDirectory()) result.push(...(await filesIn(path)));
		else if (item.isFile()) result.push(path);
	}
	return result.sort();
}
function futureNote(path) {
	return path
		.replace(/^data\//, 'notes/')
		.replace(/^notes\/misc\//, 'notes/reference/')
		.replace(/^notes\/TODO\//, 'notes/investigations/');
}
const allInputs = [];
for (const folder of ['data', 'templates', 'resources', 'cover'])
	allInputs.push(...(await filesIn(join(project, folder))));
allInputs.push(join(project, 'report.md'));
const snapshots = [];
for (const path of allInputs.sort()) {
	const bytes = await readFile(path);
	snapshots.push({ path: rel(path), bytes: bytes.length, sha256: sha(bytes) });
}
await mkdir(destination, { recursive: true });
if ((await readdir(destination)).length)
	throw new Error('Capture destination must be empty; preserve the frozen baseline');
const raw = await api.read_files(await api.get_files({ project }));
const parsed = api.parse_data(raw);
const prepared = await api.loadProject({ project });
const markdown = new Marked();
const metadataShapes = {};
function recordShapes(value, path, source) {
	const kind =
		value === null
			? 'null'
			: Array.isArray(value)
				? value.length
					? 'array'
					: 'empty-array'
				: value instanceof Date
					? 'timestamp'
					: typeof value;
	const bucket = (metadataShapes[path] ??= {});
	const record = (bucket[kind] ??= { count: 0, examples: [] });
	record.count++;
	if (record.examples.length < 3 && !record.examples.includes(source)) record.examples.push(source);
	if (Array.isArray(value)) value.forEach((item) => recordShapes(item, `${path}[]`, source));
	else if (value && typeof value === 'object' && !(value instanceof Date)) {
		for (const [key, item] of Object.entries(value))
			recordShapes(item, path ? `${path}.${key}` : key, source);
	}
}
const references = [];
const addReference = (source, kind, target, extra = {}) =>
	references.push({ source, kind, target, ...extra });
const notes = [];
for (const document of raw) {
	const source = rel(document.path);
	const match =
		/^(?:\uFEFF)?---[^\S\r\n]*\r?\n([\s\S]*?)(?:^---[^\S\r\n]*|^\.\.\.[^\S\r\n]*)(?:\r?\n|$)/m.exec(
			document.contents,
		);
	if (!match || match.index !== 0) throw new Error(`Cannot preserve header for ${source}`);
	const metadata = parse(match[1], { customTags: ['timestamp'] });
	for (const [key, value] of Object.entries(metadata)) recordShapes(value, key, source);
	const body = document.contents.slice(match[0].length);
	const tokens = markdown.lexer(body);
	markdown.walkTokens(tokens, (token) => {
		if (token.type === 'link' || token.type === 'image') {
			addReference(
				source,
				token.type === 'image'
					? 'markdown-image'
					: /^\[[\s\S]*\]\(/.test(token.raw)
						? 'markdown-inline-link'
						: 'markdown-reference-link',
				token.href,
				{ raw: token.raw },
			);
		}
		if (token.type === 'html') {
			const $ = load(token.raw);
			$('[href], [src]').each((_i, element) => {
				for (const attr of ['href', 'src']) {
					const target = $(element).attr(attr);
					if (target) addReference(source, `html-${attr}`, target);
				}
			});
		}
	});
	for (const [label, target] of Object.entries(tokens.links))
		addReference(source, 'reference-definition', target.href, { label });
	for (const field of ['also', 'monoDirectionalLinks']) {
		for (const target of metadata[field] ?? []) addReference(source, `metadata-${field}`, target);
	}
	for (const [ordinal, figure] of (metadata.figures ?? []).entries())
		addReference(source, 'metadata-figure', `resources/${figure.file}`, {
			ordinal: ordinal + 1,
			caption: figure.caption,
		});
	notes.push({
		path: source,
		targetPath: futureNote(source),
		legacySlug: document.path.split(sep).at(-1).slice(0, -3),
		identity: futureNote(source).slice(0, -3),
		sha256: sha(document.contents),
		frontmatterSha256: sha(match[0]),
		frontmatterBytes: Buffer.byteLength(match[0]),
		rawFrontmatter: match[0],
		metadata,
		headings: body.split('\n').filter((line) => /^#{1,6}\s/.test(line)),
	});
}
// Inventory HTML/SCSS/SVG references for review, retaining origin and dependency status.
for (const path of allInputs.filter((path) =>
	['.html', '.scss', '.css', '.svg'].includes(extname(path)),
)) {
	const text = await readFile(path, 'utf8');
	for (const match of text.matchAll(
		/(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'";]+)["']?\s*\)/g,
	)) {
		const prefix = text.slice(0, match.index);
		const commented =
			['.html', '.svg'].includes(extname(path)) &&
			prefix.lastIndexOf('<!--') > prefix.lastIndexOf('-->');
		addReference(rel(path), 'asset-reference', match[1] ?? match[2], { active: !commented });
	}
}
const inputSet = new Set(snapshots.map((item) => item.path));
const attachmentPaths = new Set();
for (const reference of references) {
	const { target, source, kind } = reference;
	if (kind.startsWith('metadata-') && kind !== 'metadata-figure') continue;
	if (/^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(target)) continue;
	let candidate;
	if (kind === 'metadata-figure') candidate = target;
	else if (source === 'templates/index.html' && target.startsWith('../'))
		candidate = target.slice(3);
	else candidate = posix(join(dirname(source), decodeURIComponent(target.split(/[?#]/, 1)[0])));
	reference.resolvedPath = candidate;
	reference.exists = inputSet.has(candidate);
	if (reference.exists && candidate.startsWith('resources/')) attachmentPaths.add(candidate);
}
// Include local dependencies of attachment assets until the closure stops growing.
let changed;
do {
	changed = false;
	for (const reference of references) {
		if (
			attachmentPaths.has(reference.source) &&
			reference.exists &&
			reference.resolvedPath.startsWith('resources/') &&
			!attachmentPaths.has(reference.resolvedPath)
		) {
			attachmentPaths.add(reference.resolvedPath);
			changed = true;
		}
	}
} while (changed);
const moveMap = snapshots.map((item) => {
	const source = item.path;
	let target;
	let review;
	if (source.split('/').some((part) => part === '.DS_Store'))
		review = 'Local filesystem metadata: exclude from migration without deleting the original.';
	else if (source === 'data/categories.json') target = 'publishing/categories.json';
	else if (source.startsWith('data/')) target = futureNote(source);
	else if (source === 'templates/index.html') target = 'publishing/layout.html';
	else if (source === 'templates/index.css')
		review = 'Generated CSS: preserve for review, never migrate as publishing input.';
	else if (source.startsWith('templates/'))
		target = source.replace('templates/', 'publishing/themes/');
	else if (source.startsWith('cover/')) target = source.replace('cover/', 'artwork/covers/');
	else if (source === 'report.md') target = 'drafts/report.md';
	else if (attachmentPaths.has(source)) {
		target = source.replace('resources/', 'attachments/');
		if (
			references
				.filter((reference) => reference.resolvedPath === source)
				.every((reference) => reference.active === false)
		)
			review =
				'Referenced only in commented-out layout alternatives: proposed attachment move needs review.';
	} else if (/\.(?:psd|graffle)(?:\/|$)|\.pxd\//i.test(source)) {
		target = source.replace('resources/', 'artwork/sources/');
		review = 'Editable original: dependency graph may be opaque; preserve all package contents.';
	} else {
		review = 'Unreferenced resource: retain in place pending review; no automatic deletion.';
	}
	return {
		source,
		...(target ? { target } : {}),
		...(review ? { review } : {}),
		sha256: item.sha256,
	};
});
const figureMappings = [];
for (const entry of prepared.entries) {
	const $ = load(entry.html);
	$('figure').each((ordinal, element) =>
		figureMappings.push({
			legacyId: $(element).attr('id'),
			target: notes.find((note) => note.legacySlug === entry.slug).identity,
			ordinal: ordinal + 1,
		}),
	);
}
const legacyMap = {
	version: 1,
	entries: notes
		.map((note) => ({ legacySlug: note.legacySlug, target: note.identity }))
		.sort((a, b) => a.legacySlug.localeCompare(b.legacySlug)),
	figures: figureMappings,
};
const typeCounts = {};
for (const entry of parsed) typeCounts[entry.type] = (typeCounts[entry.type] ?? 0) + 1;
const linkForms = {};
for (const reference of references)
	linkForms[reference.kind] = (linkForms[reference.kind] ?? 0) + 1;
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
const working = await mkdtemp(join(tmpdir(), 'cross-doc-obsidian-baseline-'));
const renderFacts = [];
try {
	for (const folder of ['data', 'templates', 'resources'])
		await cp(join(project, folder), join(working, folder), { recursive: true });
	// Full current HTML captures all entries and links before selected-output removal.
	const $ = await api.generate_html(prepared.entries, { project: working, theme: 'A5' });
	api.replace_placeholders($);
	await api.add_table_of_contents($, { project: working });
	api.add_title_attributes($);
	await writeFile(join(destination, 'full-A5.html'), $.html());
	const dependencies = {};
	for (const theme of prepared.themes) {
		const result = await compileAsync(join(working, 'templates', theme, 'index.scss'), {
			logger: { warn() {} },
		});
		dependencies[theme] = {
			imports: result.loadedUrls
				.filter((url) => url.protocol === 'file:')
				.map((url) => posix(relative(working, fileURLToPath(url))))
				.sort(),
			cssSha256: sha(result.css),
		};
		await writeFile(join(destination, `${theme}.css`), result.css);
	}
	await json('template-dependencies.json', dependencies);
	for (const theme of ['A5', 'reduced']) {
		const folder = join(destination, 'output/pdf', theme);
		await mkdir(folder, { recursive: true });
		const selected = await api.compileProject({
			project: working,
			theme,
			include: selection,
			html_file_name: join(folder, 'representative.html'),
			pdf_file_name: join(folder, 'representative.pdf'),
			embedded_html_file_name: join(folder, 'representative-complete.html'),
		});
		// Original linked HTML refers to a temporary copy; retain only the portable embedded version.
		await rm(join(folder, 'representative.html'));
		await writeFile(
			join(folder, 'representative.txt'),
			command('pdftotext', ['-layout', join(folder, 'representative.pdf'), '-']),
		);
		await writeFile(
			join(folder, 'pdffonts.txt'),
			command('pdffonts', [join(folder, 'representative.pdf')]) + '\n',
		);
		const info = command('pdfinfo', [join(folder, 'representative.pdf')]);
		await writeFile(join(folder, 'pdfinfo.txt'), info + '\n');
		renderFacts.push({
			theme,
			selection,
			diagnostics: selected.diagnostics,
			pages: Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]),
			cssSha256: sha(await readFile(join(working, 'templates/index.css'))),
			pdfSha256: sha(await readFile(join(folder, 'representative.pdf'))),
		});
	}
} finally {
	await rm(working, { recursive: true, force: true });
}
// Verify every input remained unchanged during the complete capture.
for (const item of snapshots)
	if (sha(await readFile(join(project, item.path))) !== item.sha256)
		throw new Error(`Source changed during capture: ${item.path}`);
await json('source-hashes.json', snapshots);
await json('inventory.json', {
	version: 1,
	summary: {
		notes: notes.length,
		types: typeCounts,
		figures: figureMappings.length,
		themes: prepared.themes,
		metadataShapes: Object.keys(metadataShapes).length,
		linkForms,
		referencedResources: attachmentPaths.size,
	},
	metadataShapes,
	notes,
	references,
});
await json('move-map.json', moveMap);
await json('legacy-links.example.json', legacyMap);
await json('diagnostics.json', prepared.diagnostics);
await json('capture.json', {
	date: new Date().toISOString().slice(0, 10),
	timezone: 'UTC',
	node: process.version,
	prince: command('prince', ['--version']),
	poppler: command('pdfinfo', ['-v']),
	libraryCommit: command('git', ['rev-parse', 'HEAD'], libraryRoot),
	projectCommit: command('git', ['rev-parse', 'HEAD'], project),
	libraryStatus: command('git', ['status', '--short'], libraryRoot),
	projectStatus: command('git', ['status', '--short'], project),
	sourceHash: sha(JSON.stringify(snapshots)),
	renderFacts,
});
console.log(
	JSON.stringify(
		{
			destination,
			notes: notes.length,
			figures: figureMappings.length,
			diagnostics: prepared.diagnostics.length,
			renders: renderFacts.map(({ theme, pages }) => ({ theme, pages })),
		},
		null,
		2,
	),
);
