import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load } from 'cheerio';
const prince = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: prince }));
import * as api from '../src/index.ts';
import { vaultFixture } from './vault-fixture.mjs';
import { resolveAsset } from '../src/assets.ts';

let fixture;
const write = async (path, contents) => {
	const file = join(fixture.project, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, contents);
};
const note = (path, body, metadata = {}) =>
	write(
		path,
		`---\n${JSON.stringify({ type: 'person', title: 'Alice', ...metadata })}\n---\n# Alice\n\n${body}\n`,
	);
const options = (include) => ({
	project: fixture.project,
	theme: 'default',
	html_file_name: join(fixture.project, 'exports/book.html'),
	pdf_file_name: join(fixture.project, 'exports/book.pdf'),
	embedded_html_file_name: join(fixture.project, 'exports/complete.html'),
	...(include ? { include } : {}),
});
const compile = async (include) => {
	const result = await api.compileProject(options(include));
	return {
		...result,
		$: load(await readFile(options().html_file_name, 'utf8')),
		embedded: load(await readFile(options().embedded_html_file_name, 'utf8')),
	};
};
const map = async (figures) =>
	write('publishing/legacy-links.json', JSON.stringify({ ...fixture.mappings, figures }));
beforeEach(async () => {
	fixture = await vaultFixture();
	await map([]);
	prince
		.mockReset()
		.mockImplementation(
			(_bin, args, _opts, callback) =>
				void writeFile(args[3], 'PDF').then(() => callback(null), callback),
		);
});
afterEach(async () => fixture.cleanup());

it('renders inline figures in place and appends metadata figures once, with shared IDs, references and TOC', async () => {
	await note(
		'notes/alice.md',
		'Before.\n\n![independent alt](../attachments/map.svg "First")\n\nBetween.\n\n![second](../attachments/map.svg "Second")\n\nAfter.',
		{ figures: [{ file: 'map.svg', caption: 'Legacy' }] },
	);
	const { $, embedded } = await compile(['notes/alice']);
	const section = $('.entry');
	expect(
		section
			.find('figure')
			.map((_i, n) => $(n).attr('id'))
			.get(),
	).toEqual(['figure/notes/alice/1', 'figure/notes/alice/2', 'figure/notes/alice/3']);
	expect(
		section
			.children('p,figure')
			.map((_i, n) => ($(n).is('figure') ? $(n).find('figcaption').text() : $(n).text()))
			.get(),
	).toEqual(['Before.', 'fig. 1 First', 'Between.', 'fig. 2 Second', 'After.', 'fig. 3 Legacy']);
	expect($('figure img').first().attr('alt')).toBe('independent alt');
	expect(
		$('figure img')
			.map((_i, n) => $(n).attr('src'))
			.get(),
	).toEqual(Array(3).fill('../attachments/map.svg'));
	expect(
		embedded('figure img')
			.map((_i, n) => $(n).attr('src').startsWith('data:image/svg+xml;base64,'))
			.get(),
	).toEqual([true, true, true]);
	expect(
		$('.figure-link')
			.map((_i, n) => $(n).text())
			.get(),
	).toEqual(['See fig. 1', 'See fig. 2', 'See fig. 3']);
	expect($('#category_figures a')).toHaveLength(3);
	expect($('[data-cross-doc-captioned]')).toHaveLength(0);
});

it('keeps untitled, empty-title and prose images ordinary, and never interprets code as figures', async () => {
	await note(
		'notes/alice.md',
		'![ordinary](../attachments/map.svg)\n\n![empty](../attachments/map.svg "")\n\nProse ![inline](../attachments/map.svg "Title") here.\n\n`![code](missing.png "No")`\n\n```md\n![fence](missing.png "No")\n```\n\n<img src="../attachments/map.svg" title="Raw HTML">',
	);
	const { $ } = await compile(['notes/alice']);
	expect($('figure')).toHaveLength(0);
	expect($('.entry img')).toHaveLength(4);
	expect(
		$('.entry img')
			.map((_i, n) => $(n).attr('src'))
			.get(),
	).toEqual(Array(4).fill('../attachments/map.svg'));
});

it('round-trips multiline, punctuation-heavy captions as text without typography changes or markup injection', async () => {
	const caption = 'A "quote", apostrophe\'s & <em>literal</em> \\ [bracket]\nsecond line';
	const escaped = caption.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
	await note('notes/alice.md', `![alt &amp; accessibility](../attachments/map.svg "${escaped}")`);
	const { $ } = await compile(['notes/alice']);
	expect($('figcaption').text()).toBe(`fig. 1 ${caption}`);
	expect($('figcaption em')).toHaveLength(0);
	expect($('figure img').attr('title')).toBe(caption);
	expect($('figure img').attr('alt')).toBe('alt & accessibility');
});

it('includes reference-style image figures and numbered lists without moving their source position', async () => {
	await note(
		'notes/alice.md',
		'1. Before\n\n   ![image][picture]\n\n2. After\n\n[picture]: ../attachments/map.svg "Reference caption"',
	);
	const { $ } = await compile(['notes/alice']);
	expect($('li figure')).toHaveLength(1);
	expect($('li figure figcaption').text()).toBe('fig. 1 Reference caption');
});

it('validates legacy figure mappings against inline figures and unlinks excluded owners', async () => {
	await note(
		'notes/alice.md',
		'![one](../attachments/map.svg "One")\n\n![two](../attachments/map.svg "Two")',
	);
	await note('notes/bob.md', '[old figure](#figure-alice)', { title: 'Bob' });
	await map([{ legacyId: 'figure-alice', target: 'notes/alice', ordinal: 2 }]);
	const full = await compile();
	expect(
		full
			.$('a')
			.filter((_i, n) => full.$(n).text() === 'old figure')
			.attr('href'),
	).toBe('#figure/notes/alice/2');
	const selected = await compile(['notes/bob']);
	expect(selected.$('a').filter((_i, n) => selected.$(n).text() === 'old figure')).toHaveLength(0);
	expect(selected.diagnostics).toContainEqual(
		expect.objectContaining({
			code: 'excluded-link-target',
			source: 'notes/bob',
			target: 'notes/alice',
		}),
	);
	await map([{ legacyId: 'figure-alice', target: 'notes/alice', ordinal: 3 }]);
	await expect(api.indexProject({ project: fixture.project })).rejects.toThrow(
		'Invalid legacy figure ordinal',
	);
});

it('restarts caption numbering for selected output without changing per-note figure IDs', async () => {
	await note('notes/alice.md', '![one](../attachments/map.svg "Alice")');
	await note('notes/bob.md', '![one](../attachments/map.svg "Bob")', { title: 'Bob' });
	const full = await compile();
	const selected = await compile(['notes/bob']);
	expect(full.$('[id="figure/notes/bob/1"] figcaption').text()).toBe('fig. 2 Bob');
	expect(selected.$('[id="figure/notes/bob/1"] figcaption').text()).toBe('fig. 1 Bob');
});

it('resolves nested note, layout and imported SCSS assets from their separate authoring locations', async () => {
	await write('attachments/Café 100%.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
	await note(
		'notes/nested/example.md',
		'![alt](../../attachments/Caf%C3%A9%20100%25.svg "Nested")',
	);
	await write(
		'publishing/layout.html',
		'<html><head><link rel="stylesheet" data-cross-doc-theme href="ignored.css"><link rel="stylesheet" href="extra.css"></head><body><nav id="toc"></nav><img id="logo" src="../attachments/map.svg"><main></main></body></html>',
	);
	await write('publishing/extra.css', '.extra { background: url("../attachments/map.svg"); }');
	await write(
		'publishing/themes/default/index.scss',
		'@use "parts/images"; body { font-family: sans-serif; background: url("../../../attachments/map.svg"); }',
	);
	await write(
		'publishing/themes/default/parts/_images.scss',
		'.partial { background: url("../../../../attachments/Caf%C3%A9%20100%25.svg"); content: "url(missing.png)"; }',
	);
	const { $, embedded } = await compile(['notes/nested/example']);
	expect($('figure img').attr('src')).toBe('../attachments/Caf%C3%A9%20100%25.svg');
	expect($('#logo').attr('src')).toBe('../attachments/map.svg');
	const css = await readFile(join(fixture.project, 'exports/cross-doc.css'), 'utf8');
	expect(css.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(2);
	expect(css).toContain('url(missing.png)');
	expect($('link').last().attr('href')).toMatch(/^data:text\/css;base64,/);
	const extra = Buffer.from($('link').last().attr('href').split(',')[1], 'base64').toString();
	expect(extra).toContain('data:image/svg+xml;base64,');
	expect(embedded('link').first().attr('href')).toMatch(/^data:text\/css;base64,/);
});

it.each([
	'../attachments/missing.png',
	'../../outside.png',
	'../attachments/%2e%2e/%2e%2e/outside.png',
	'../attachments/%2fsecret.png',
	'../attachments/bad%ZZ.png',
	'file:///etc/passwd',
])('fails with source context for unsafe or missing body asset %s', async (reference) => {
	await note('notes/alice.md', `![bad](${reference} "Bad")`);
	await expect(compile(['notes/alice'])).rejects.toThrow(/asset|file URLs/);
	expect(prince).not.toHaveBeenCalled();
});

it('rejects escaping symlinks in body, layout and stylesheet assets before Prince', async () => {
	await symlink('/etc/passwd', join(fixture.project, 'attachments/escape.png'));
	for (const context of ['body', 'layout', 'css']) {
		await note(
			'notes/alice.md',
			context === 'body' ? '![bad](../attachments/escape.png "Bad")' : 'Safe',
		);
		await write(
			'publishing/layout.html',
			`<html><head><link rel="stylesheet" href="ignored.css"></head><body>${context === 'layout' ? '<img src="../attachments/escape.png">' : ''}<main></main></body></html>`,
		);
		await write(
			'publishing/themes/default/index.scss',
			context === 'css'
				? 'body { background: url("../../../attachments/escape.png"); }'
				: 'body {color: black;}',
		);
		await expect(compile(['notes/alice'])).rejects.toThrow('symlink escapes');
	}
	expect(prince).not.toHaveBeenCalled();
});

it('embeds local SVG dependencies recursively and preserves local symbol fragments', async () => {
	await write(
		'attachments/composite.svg',
		'<svg xmlns="http://www.w3.org/2000/svg"><image href="map.svg"/><use href="map.svg#symbol"/><style>.paint { fill: url(#gradient) }</style></svg>',
	);
	const asset = await resolveAsset(
		'../attachments/composite.svg',
		join(fixture.project, 'notes/alice.md'),
		fixture.project,
	);
	const svg = load(Buffer.from(asset.data.split(',')[1], 'base64').toString(), { xmlMode: true });
	expect(svg('image').attr('href')).toMatch(/^data:image\/svg\+xml;base64,/);
	expect(svg('use').attr('href')).toMatch(/#symbol$/);
	expect(svg('style').text()).toContain('url(#gradient)');
	await write('attachments/composite.svg', '<svg><image href="composite.svg"/></svg>');
	await expect(
		resolveAsset(
			'../attachments/composite.svg',
			join(fixture.project, 'notes/alice.md'),
			fixture.project,
		),
	).rejects.toThrow('Circular asset dependency');
});

it('resolves local CSS imports and their own asset URLs, rejecting missing imported assets', async () => {
	await write('publishing/themes/default/index.scss', '@import "nested.css"; body {color: black;}');
	await write(
		'publishing/themes/default/nested.css',
		'.image {background: url("../../../attachments/map.svg")}',
	);
	await compile(['notes/bob']);
	const css = await readFile(join(fixture.project, 'exports/cross-doc.css'), 'utf8');
	expect(css).toContain('@import "data:text/css;base64,');
	const nested = Buffer.from(css.match(/data:text\/css;base64,([^" ]+)/)[1], 'base64').toString();
	expect(nested).toContain('data:image/svg+xml;base64,');
	await write('publishing/themes/default/nested.css', '.image {background: url("missing.png")}');
	await expect(compile(['notes/bob'])).rejects.toThrow('missing.png');
});

it('supports inline figures through the legacy standalone primitives', async () => {
	const parsed = api.parse_data([
		{
			path: join(fixture.project, 'notes/alice.md'),
			contents:
				'---\ntype: person\ntitle: Alice\n---\n# Alice\n\n![alt](../attachments/map.svg "Caption")',
		},
	]);
	const entries = api.add_front_matter(api.clean_html(parsed), {});
	const $ = load(entries[0].html);
	expect($('figure').attr('id')).toBe('figure-alice');
	expect($('figure img').attr('alt')).toBe('alt');
});

it('resolves canonical figure destinations, diagnoses invalid ordinals and preserves selected-owner semantics', async () => {
	await note('notes/alice.md', '![alt](../attachments/map.svg "Caption")');
	await note(
		'notes/bob.md',
		'[canonical](#figure/notes/alice/1) [invalid](#figure/notes/alice/2)',
		{ title: 'Bob' },
	);
	const { $, diagnostics } = await compile();
	const link = $('a').filter((_i, n) => $(n).text() === 'canonical');
	expect(link.attr('href')).toBe('#figure/notes/alice/1');
	expect(link.attr('title')).toBe('fig. 1 Caption');
	expect($('a').filter((_i, n) => $(n).text() === 'invalid')).toHaveLength(0);
	expect(diagnostics).toContainEqual(
		expect.objectContaining({ source: 'notes/bob', target: '#figure/notes/alice/2' }),
	);
	const selected = await compile(['notes/bob']);
	expect(selected.$('a').filter((_i, n) => selected.$(n).text() === 'canonical')).toHaveLength(0);
});

it('encodes literal metadata filenames and preserves body-image fragments at external output destinations', async () => {
	await write('attachments/100% image.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
	await note('notes/alice.md', '![view](../attachments/100%25%20image.svg#view "View")', {
		figures: [{ file: '100% image.svg', caption: 'Metadata' }],
	});
	const { $, embedded } = await compile(['notes/alice']);
	expect(
		$('figure img')
			.map((_i, n) => $(n).attr('src'))
			.get(),
	).toEqual(['../attachments/100%25%20image.svg#view', '../attachments/100%25%20image.svg']);
	expect(embedded('figure img').first().attr('src')).toMatch(/#view$/);
});

it('embeds layout and note style URLs from their authoring locations', async () => {
	await note(
		'notes/alice.md',
		'<p style="background-image: url(../attachments/map.svg)">Styled</p>',
	);
	await write(
		'publishing/layout.html',
		'<html><head><link rel="stylesheet" href="ignored.css"><style>.logo {background: url(../attachments/map.svg)}</style></head><body><main></main></body></html>',
	);
	const { $ } = await compile(['notes/alice']);
	expect($('style').text()).toContain('data:image/svg+xml;base64,');
	expect($('.entry p[style]').attr('style')).toContain('data:image/svg+xml;base64,');
});

it('rejects stylesheet imports outside the project and local file URLs in CSS', async () => {
	await symlink('/etc', join(fixture.project, 'publishing/themes/default/outside'));
	await write('publishing/themes/default/index.scss', '@use "outside/passwd";');
	await expect(compile(['notes/bob'])).rejects.toThrow();
	await write(
		'publishing/themes/default/index.scss',
		'body {background:url("file:///etc/passwd")}',
	);
	await expect(compile(['notes/bob'])).rejects.toThrow('Local file URLs are unsupported');
	expect(prince).not.toHaveBeenCalled();
});

it('rejects a valid Sass import whose symlink points outside the project', async () => {
	const { mkdtemp, rm } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const outside = await mkdtemp(join(tmpdir(), 'cross-doc-outside-scss-'));
	try {
		await writeFile(join(outside, '_external.scss'), 'body {color: red;}');
		await symlink(outside, join(fixture.project, 'publishing/themes/default/external'));
		await write('publishing/themes/default/index.scss', '@use "external/external";');
		await expect(compile(['notes/bob'])).rejects.toThrow(/escapes project directory/);
		expect(prince).not.toHaveBeenCalled();
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});

it('rejects cyclic CSS imports and resolves escaped CSS filenames without interpreting comments', async () => {
	await write('publishing/themes/default/index.scss', '@import "a.css";');
	await write('publishing/themes/default/a.css', '@import "b.css";');
	await write('publishing/themes/default/b.css', '@import "a.css";');
	await expect(compile(['notes/bob'])).rejects.toThrow('Circular asset dependency');
	await write(
		'publishing/themes/default/index.scss',
		String.raw`body { background: url("../../../attachments/map\2e svg"); /* url(missing.png) */ }`,
	);
	await compile(['notes/bob']);
	const css = await readFile(join(fixture.project, 'exports/cross-doc.css'), 'utf8');
	expect(css).toContain('data:image/svg+xml;base64,');
	expect(css).toContain('/* url(missing.png) */');
});

it('resolves encoded figure IDs for Unicode and percent signs in note paths', async () => {
	const { figureId, idHref } = await import('../src/project_index.ts');
	const id = figureId('notes/Café 100%', 1);
	await note('notes/Café 100%.md', '![alt](../attachments/map.svg "Unicode")', { title: 'Café' });
	await note('notes/bob.md', `[Unicode figure](${idHref(id)})`, { title: 'Bob' });
	const { $ } = await compile(['notes/bob', 'notes/Café 100%']);
	expect(
		$('a')
			.filter((_i, n) => $(n).text() === 'Unicode figure')
			.attr('href'),
	).toBe(idHref(id));
	expect($('figure').attr('id')).toBe(id);
});
