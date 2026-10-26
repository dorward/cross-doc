import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load } from 'cheerio';

const prince = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: prince }));
import * as api from '../src/index.ts';
import { vaultFixture } from './vault-fixture.mjs';
import { entryId, idHref, indexWithLayout } from '../src/project_index.ts';

let fixture;
beforeEach(async () => {
	fixture = await vaultFixture();
	prince
		.mockReset()
		.mockImplementation(
			(_binary, args, _options, callback) =>
				void writeFile(args[3], 'fake PDF').then(() => callback(null), callback),
		);
});
afterEach(async () => fixture.cleanup());
const write = async (path, text) => {
	const destination = join(fixture.project, path);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, text);
};
const config = () => write('publishing/project.json', JSON.stringify(fixture.config));
const mappings = () => write('publishing/legacy-links.json', JSON.stringify(fixture.mappings));

it('inspects configured roots, rejects no unrelated Markdown and allows the old folders to coexist', async () => {
	for (const path of [
		'drafts/broken.md',
		'artwork/broken.md',
		'attachments/broken.md',
		'README.md',
		'data/broken.md',
		'notes/.hidden/broken.md',
	])
		await write(path, 'not a compiled note');
	const layout = await api.resolveProjectLayout({ project: fixture.project });
	expect(layout).toMatchObject({
		identity: 'vault-path-v1',
		paths: fixture.config.paths,
		configFile: 'publishing/project.json',
	});
	expect(
		(await api.get_files({ project: fixture.project })).map((file) =>
			file.slice(fixture.project.length + 1),
		),
	).toEqual(['notes/alice.md', 'notes/arrival.md', 'notes/bob.md', 'notes/departure.md']);
	expect(await api.inspectProject(fixture.project)).toMatchObject({ themes: ['default'] });
	expect(await api.readCategories({ project: fixture.project })).toEqual(
		(await api.inspectProject(fixture.project)).categories,
	);
});

it('indexes full paths before selection, permits duplicate basenames, and retains metadata/source bytes', async () => {
	await write(
		'notes/history/alice.md',
		'---\ntype: person\ntitle: Historical Alice\n---\n# Historical Alice',
	);
	const original = await readFile(join(fixture.project, 'notes/alice.md'), 'utf8');
	const index = await api.indexProject({ project: fixture.project });
	expect(index.entries.map((entry) => entry.identity)).toContain('notes/history/alice');
	expect(index.entries.find((entry) => entry.identity === 'notes/alice').id).toBe(
		'entry/notes/alice',
	);
	const selected = api.select_files(
		index.entries.map((entry) => entry.path),
		['alice'],
		index,
	);
	expect(selected).toEqual([join(fixture.project, 'notes/alice.md')]);
	expect(() =>
		api.select_files(
			index.entries.map((entry) => entry.path),
			['alice', 'notes/alice'],
			index,
		),
	).toThrow('Duplicate include');
	const loaded = await api.loadProject({ project: fixture.project, include: ['alice'] });
	expect(loaded.index.entries).toHaveLength(5);
	expect(loaded.entries).toHaveLength(1);
	expect(loaded.entries[0]).toMatchObject({
		slug: 'notes/alice',
		vaultPath: 'notes/alice.md',
		also: ['notes/bob'],
	});
	expect(loaded.entries[0].html).toContain('id="entry/notes/alice"');
	expect(loaded.entries[0].html).not.toContain('href="#entry/notes/bob"');
	expect(loaded.diagnostics).toContainEqual({
		code: 'legacy-reference',
		severity: 'warning',
		source: 'notes/alice',
		target: 'alice',
	});
	expect(await readFile(join(fixture.project, 'notes/alice.md'), 'utf8')).toBe(original);
});

it('renders configured categories/themes/figures/sheets and reports generated CSS in the output directory', async () => {
	const events = [];
	const project = fixture.project;
	const options = {
		project,
		theme: 'default',
		html_file_name: join(project, 'exports/document.html'),
		pdf_file_name: join(project, 'exports/document.pdf'),
		embedded_html_file_name: join(project, 'exports/embedded.html'),
	};
	const result = await api.compileProject(options, { onProgress: (event) => events.push(event) });
	const $ = load(await readFile(options.html_file_name, 'utf8'));
	expect($('[id="entry/notes/alice"] .see-also a').attr('href')).toBe('#entry/notes/bob');
	expect($('[id="entry/notes/alice"] .see-also a').attr('title')).toBe('Bob');
	expect($('[id="figure/notes/alice/1"]')).toHaveLength(1);
	expect($('[id="sheet/notes/alice"]')).toHaveLength(1);
	expect($('#toc a[href="#entry/notes/alice"]')).toHaveLength(3);
	expect($('[id="category/person"]')).toHaveLength(1);
	expect($('#timeline a[href="#entry/notes/alice"]')).toHaveLength(1);
	expect(result.artifacts[0]).toMatchObject({
		path: join(project, 'exports/cross-doc.css'),
		status: 'completed',
	});
	expect(await readFile(join(project, 'exports/cross-doc.css'), 'utf8')).toContain('#123456');
	await expect(readFile(join(project, 'publishing/index.css'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
	expect(events.filter((event) => event.status === 'started').map((event) => event.stage)).toEqual([
		'discover',
		'inspect',
		'index',
		'read',
		'parse',
		'clean',
		'metadata',
		'links',
		'sort',
		'render',
		'placeholders',
		'toc',
		'titles',
		'output',
	]);
	const embedded = load(await readFile(options.embedded_html_file_name, 'utf8'));
	expect(embedded('figure img').attr('src')).toMatch(/^data:image\/svg\+xml/);
	await api.writeGraph($, { graph_file_name: join(project, 'exports/graph.dot') });
	expect(await readFile(join(project, 'exports/graph.dot'), 'utf8')).toContain(
		'"entry/notes/alice"',
	);
});

it('uses the frozen escaping vectors in rendered links, titles and selected-output removal', async () => {
	const name = 'Café 100%';
	await write(
		`notes/${name}.md`,
		`---\ntitle: ${name}\ntype: person\nalso: [alice]\n---\n# ${name}\n\n[Alice](#alice)`,
	);
	fixture.mappings.entries.push({ legacySlug: 'cafe', target: `notes/${name}` });
	await mappings();
	await write(
		'notes/alice.md',
		(await readFile(join(fixture.project, 'notes/alice.md'), 'utf8')).replace(
			'also: [bob]',
			'also: [bob, cafe]',
		),
	);
	const loaded = await api.loadProject({ project: fixture.project });
	const cafe = loaded.entries.find((entry) => entry.slug === `notes/${name}`);
	const alice = loaded.entries.find((entry) => entry.slug === 'notes/alice');
	expect(cafe.html).toContain(`id="${entryId(cafe.slug)}"`);
	expect(
		load(alice.html)('a.see-also')
			.toArray()
			.some((a) => load(alice.html)(a).attr('href') === idHref(entryId(cafe.slug))),
	).toBe(true);
	expect(loaded.diagnostics.some((item) => item.code === 'missing-link-target')).toBe(false);
	const selected = await api.loadProject({ project: fixture.project, include: ['notes/alice'] });
	expect(selected.entries[0].html).not.toContain('href="#entry/notes/Caf');
});

it('requires explicit aliases rather than guessing a basename, and supports explicit config files', async () => {
	await write('notes/history/alice.md', '---\ntype: person\ntitle: Other\n---\n# Other');
	fixture.mappings.entries = fixture.mappings.entries.filter(
		(entry) => entry.legacySlug !== 'alice',
	);
	await mappings();
	await expect(api.loadProject({ project: fixture.project, include: ['alice'] })).rejects.toThrow(
		'Unknown include',
	);
	await rename(
		join(fixture.project, 'publishing/project.json'),
		join(fixture.project, 'publishing/custom.json'),
	);
	const options = { project: fixture.project, configFile: 'publishing/custom.json' };
	expect((await api.loadProject(options)).entries).toHaveLength(5);
	expect(await api.get_files({ ...options, include: ['notes/history/alice'] })).toEqual([
		join(fixture.project, 'notes/history/alice.md'),
	]);
	expect((await api.resolveProjectLayout({ project: fixture.project })).identity).toBe('legacy');
});

it.each([
	'../notes',
	'/notes',
	'notes/../other',
	'notes\\people',
	'notes//people',
	'C:notes',
	'notes\0bad',
])('rejects unsafe configuration paths: %s', async (path) => {
	fixture.config.paths.entries = path;
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow(
		'root-relative',
	);
});
it('does not fall back when the discovered config is malformed, unknown or incomplete', async () => {
	await write('publishing/project.json', '{broken');
	await expect(api.get_files({ project: fixture.project })).rejects.toThrow();
	fixture.config.version = 99;
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow(
		'Unsupported',
	);
	fixture.config.version = 1;
	fixture.config.extra = true;
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow('exactly');
	await expect(
		api.resolveProjectLayout({ project: fixture.project, configFile: 'missing.json' }),
	).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects overlapping roots, misplaced configuration and wrong filesystem kinds', async () => {
	fixture.config.paths.attachments = 'notes';
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow('overlap');
	fixture.config.paths.attachments = 'attachments';
	fixture.config.paths.categories = 'notes/alice.md';
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow(
		'outside entries',
	);
	fixture.config.paths.categories = 'attachments';
	await config();
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow(
		'wrong kind',
	);
});
it('rejects entry symlinks, escaping configuration symlinks and portable filename collisions', async () => {
	await symlink(join(fixture.project, 'notes/bob.md'), join(fixture.project, 'notes/linked.md'));
	await expect(api.indexProject({ project: fixture.project })).rejects.toThrow('symlinks');
	await rm(join(fixture.project, 'notes/linked.md'));
	const layout = await api.resolveProjectLayout({ project: fixture.project });
	const actualPaths = await api.get_files({ project: fixture.project });
	await expect(
		indexWithLayout(layout, [...actualPaths, join(fixture.project, 'notes/ALICE.md')]),
	).rejects.toThrow('collision');
	await expect(
		indexWithLayout(layout, [
			...actualPaths,
			join(fixture.project, 'notes/Café.md'),
			join(fixture.project, 'notes/Café.md'),
		]),
	).rejects.toThrow('collision');
	await rm(join(fixture.project, 'publishing/project.json'));
	await symlink(
		new URL('./fixtures/project/data/categories.json', import.meta.url),
		join(fixture.project, 'publishing/project.json'),
	);
	await expect(api.resolveProjectLayout({ project: fixture.project })).rejects.toThrow();
});
it.each(['duplicate-entry', 'stale-entry', 'duplicate-figure', 'stale-figure', 'bad-ordinal'])(
	'validates compatibility mappings against the full index before selection: %s',
	async (kind) => {
		if (kind === 'duplicate-entry') fixture.mappings.entries.push(fixture.mappings.entries[0]);
		if (kind === 'stale-entry') fixture.mappings.entries[0].target = 'notes/missing';
		if (kind === 'duplicate-figure') fixture.mappings.figures.push(fixture.mappings.figures[0]);
		if (kind === 'stale-figure') fixture.mappings.figures[0].target = 'notes/missing';
		if (kind === 'bad-ordinal') fixture.mappings.figures[0].ordinal = 2;
		await mappings();
		await expect(
			api.loadProject({ project: fixture.project, include: ['notes/bob'] }),
		).rejects.toMatchObject({ stage: 'index' });
	},
);

it('renders configured CSS into an external output directory without relaxing source asset containment', async () => {
	const project = fixture.project;
	const external = `${project}-output`;
	const options = {
		project,
		theme: 'default',
		html_file_name: join(external, 'book.html'),
		pdf_file_name: join(external, 'book.pdf'),
		embedded_html_file_name: join(external, 'embedded.html'),
	};
	try {
		const result = await api.compileProject(options);
		expect(result.artifacts[0].path).toBe(join(external, 'cross-doc.css'));
		const html = load(await readFile(options.html_file_name, 'utf8'));
		expect(html('link[rel=stylesheet]').attr('href')).toBe('cross-doc.css');
		const embedded = load(await readFile(options.embedded_html_file_name, 'utf8'));
		expect(embedded('link[rel=stylesheet]').attr('href')).toMatch(/^data:text\/css;base64,/);
		expect(embedded('figure img').attr('src')).toMatch(/^data:image\/svg\+xml;base64,/);
	} finally {
		await rm(external, { recursive: true, force: true });
	}
});

it('matches every frozen ID/fragment vector and exposes only serializable index data', async () => {
	const vectors = JSON.parse(
		await readFile(
			new URL('../docs/obsidian-conversion/identity-vectors.json', import.meta.url),
			'utf8',
		),
	);
	for (const vector of vectors.valid) {
		expect(entryId(vector.identity)).toBe(vector.id);
		expect(idHref(entryId(vector.identity))).toBe(vector.href);
	}
	const index = await api.indexProject({ project: fixture.project });
	expect(JSON.parse(JSON.stringify(index))).toEqual(index);
	const docs = await api.read_files(index.entries.map((entry) => entry.path));
	expect(api.parse_data(docs, index).map((entry) => entry.slug)).toEqual(
		index.entries.map((entry) => entry.identity),
	);
	expect(api.parse_data(docs).map((entry) => entry.slug)).toEqual([
		'alice',
		'arrival',
		'bob',
		'departure',
	]);
});
