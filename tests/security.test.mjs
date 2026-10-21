import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'cheerio';

const renderer = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: renderer }));
import * as api from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

let fixture;
let outside;
beforeEach(async () => {
	fixture = await projectFixture();
	outside = await mkdtemp(join(tmpdir(), 'cross-doc-outside-'));
	await writeFile(join(outside, 'secret.txt'), 'private content');
	renderer.mockReset().mockImplementation((_binary, _args, _options, callback) => callback(null));
});
afterEach(async () => {
	await fixture.cleanup();
	await rm(outside, { recursive: true, force: true });
});
const outputOptions = () => ({
	project: fixture.project,
	html_file_name: join(fixture.project, 'out/document.html'),
	pdf_file_name: join(fixture.project, 'out/document.pdf'),
	embedded_html_file_name: join(fixture.project, 'out/embedded.html'),
});
const parse = (metadata) =>
	api.parse_data([{ path: 'example.md', contents: `---\n${metadata}\n---\n# Example` }]);

it.each(['__proto__', 'constructor', 'prototype'])('rejects unsafe YAML key %s', (key) => {
	expect(() => parse(`title: Example\ntype: person\nextra:\n  ${key}: bad`)).toThrow(
		'Unsafe front matter key',
	);
});

it('rejects duplicate YAML keys, oversized headers and excessive nesting', () => {
	expect(() => parse('title: One\ntitle: Two\ntype: person')).toThrow();
	expect(() => parse(`title: Example\ntype: person\nextra: ${'x'.repeat(1024 * 1024)}`)).toThrow(
		'Front matter exceeds',
	);
	expect(() =>
		parse(`title: Example\ntype: person\nextra: ${'['.repeat(52)}0${']'.repeat(52)}`),
	).toThrow('nesting exceeds');
});

it('bounds YAML alias expansion', () => {
	expect(() =>
		parse(
			`title: Example\ntype: person\na: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]`,
		),
	).toThrow(/alias|resource/i);
});

it('preserves JSON-style front matter, dates, CRLF and computed fields', () => {
	const [entry] = api.parse_data([
		{
			path: '/example.md',
			contents:
				'\uFEFF---\r\n{"title":"Example","type":"person","html":"injected","slug":"wrong"}\r\n---\r\n# Example',
		},
	]);
	expect(entry.slug).toBe('example');
	expect(entry.html).toContain('<h1 id="example">Example</h1>');
	expect(entry.__content).toBe('# Example');
	const [dated] = parse('title: Example\ntype: person\ndate: 2020-02-03');
	expect(dated.date).toBeInstanceOf(Date);
});

it('rejects actual walker failures instead of leaving a pending promise', async () => {
	await expect(api.get_files({ project: join(fixture.project, 'absent') })).rejects.toMatchObject({
		code: 'ENOENT',
	});
});

it('escapes rendered metadata and removes secret alias index entries', () => {
	const source = {
		slug: 'example',
		title: 'Example',
		html: '<h1>Example</h1>',
		pc: '<img src=x onerror=alert(1)>',
		alias: [
			{ name: '<script>bad</script>' },
			{ name: 'Secret', index: 'Hidden index', secret: true },
		],
		figures: [{ file: 'map.svg', caption: '<script>caption</script>' }],
	};
	const [entry] = api.add_front_matter(api.clean_html([source]), { include: ['example'] });
	const $ = load(entry.html);
	expect($('script, img[onerror]')).toHaveLength(0);
	expect($('.PC').text()).toContain('<img src=x onerror=alert(1)>');
	expect($('.aliases').text()).toContain('<script>bad</script>');
	expect($('figcaption').text()).toContain('<script>caption</script>');
	expect($('h2').data('index')).toEqual(['Example', '<script>bad</script>']);
});

it('treats external and unusual fragment links as values rather than selectors', async () => {
	const $ = load(
		'<section id="entry:one"><h2>One</h2></section><a href="#entry:one">One</a><a href="https://example.com/">Web</a><a href="mailto:me@example.com">Mail</a>',
	);
	expect(() => api.add_title_attributes($)).not.toThrow();
	expect($('a').first().attr('title')).toBe('One');
	await api.output($, outputOptions());
	expect($('a').eq(1).attr('href')).toBe('https://example.com/');
	expect($('a').eq(2).attr('href')).toBe('mailto:me@example.com');
});

it('rejects traversal and symlinks before invoking the renderer', async () => {
	const outsideReference = `../../${outside.split('/').pop()}/secret.txt`;
	await expect(
		api.output(load(`<img src="${outsideReference}">`), outputOptions()),
	).rejects.toThrow('escapes project');
	await symlink(join(outside, 'secret.txt'), join(fixture.project, 'resources/link.txt'));
	await expect(
		api.output(load('<img src="../resources/link.txt">'), outputOptions()),
	).rejects.toThrow('symlink escapes');
	expect(renderer).not.toHaveBeenCalled();
});

it('passes paths with spaces and shell characters as arguments to a configurable binary', async () => {
	const options = {
		...outputOptions(),
		prince_binary: '/tools/Prince App/prince',
		pdf_file_name: join(fixture.project, 'out/spaces;$(echo nope).pdf'),
	};
	await api.output(load('<p>Safe arguments</p>'), options);
	expect(renderer).toHaveBeenCalledWith(
		options.prince_binary,
		['--no-network', options.html_file_name, '-o', options.pdf_file_name],
		expect.objectContaining({ timeout: 30000 }),
		expect.any(Function),
	);
});

it('writes escaped DOT to a chosen path and skips external links', async () => {
	const $ = load(
		'<section class="category" id="person"><section class="entry" id="a&quot;node"><h2>A &quot;quote&quot;\nline</h2><a href="https://example.com">Web</a></section></section>',
	);
	const path = join(fixture.project, 'graphs/output.dot');
	await api.generate_graph($, [], { graph_file_name: path });
	const dot = await readFile(path, 'utf8');
	expect(dot).toContain('"a\\"node"');
	expect(dot).toContain('label = "A \\"quote\\"\\nline"');
	expect(dot).not.toContain('https://');
});

it('compiles relative Sass modules and preserves CSS asset URLs', async () => {
	await writeFile(join(fixture.project, 'templates/default/_palette.scss'), '$accent: #abcdef;');
	await writeFile(
		join(fixture.project, 'templates/default/index.scss'),
		'@use "palette"; body { color: palette.$accent; background: url("../resources/map.svg"); }',
	);
	await api.generate_html([], { project: fixture.project, theme: 'default' });
	const css = await readFile(join(fixture.project, 'templates/index.css'), 'utf8');
	expect(css).toContain('color: #abcdef');
	expect(css).toContain('../resources/map.svg');
	await writeFile(join(fixture.project, 'templates/default/index.scss'), 'body { broken:');
	await expect(
		api.generate_html([], { project: fixture.project, theme: 'default' }),
	).rejects.toThrow();
});

it.each(['document.html', 'out/document.html', 'out/deep/document.html'])(
	'rebases local image and stylesheet URLs for HTML at %s while preserving embedding',
	async (file) => {
		const options = { ...outputOptions(), html_file_name: join(fixture.project, file) };
		await writeFile(join(fixture.project, 'templates/index.css'), 'body { color: red; }');
		const $ = load(
			'<link rel="stylesheet" href="../templates/index.css?v=1"><img src="../resources/map.svg#map"><a href="#local">Local</a><a href="https://example.com/">Remote</a>',
		);
		await api.output($, options);
		const normal = load(await readFile(options.html_file_name, 'utf8'));
		const prefix = file === 'document.html' ? '' : file.startsWith('out/deep/') ? '../../' : '../';
		expect(normal('link').attr('href')).toBe(`${prefix}templates/index.css?v=1`);
		expect(normal('img').attr('src')).toBe(`${prefix}resources/map.svg#map`);
		expect(normal('a').first().attr('href')).toBe('#local');
		expect(normal('a').last().attr('href')).toBe('https://example.com/');
		const embedded = load(await readFile(options.embedded_html_file_name, 'utf8'));
		expect(embedded('link').attr('href')).toContain('data:text/css;base64,');
		expect(embedded('img').attr('src')).toContain('data:image/svg+xml;base64,');
	},
);
