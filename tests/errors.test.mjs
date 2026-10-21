import { afterEach, expect, it, vi } from 'vitest';
import { load } from 'cheerio';
import * as api from '../src/index.ts';

const graphWrite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/internal/write.ts', () => ({ default: graphWrite }));
afterEach(() => {
	vi.restoreAllMocks();
	graphWrite.mockClear();
});

it('rejects missing files when reading a document batch', async () => {
	await expect(api.read_files(['/missing-cross-doc-fixture.md'])).rejects.toThrow();
});

it('rejects missing files from the single-file reader', async () => {
	await expect(api.read('/missing-cross-doc-fixture.md')).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
	['malformed YAML', '---\ntitle: [broken\n---\n# Broken'],
	['missing title', '---\ntype: person\n---\n# Broken'],
	['missing type', '---\ntitle: Broken\n---\n# Broken'],
])('rejects %s without terminating the caller', (_, contents) => {
	const exit = vi.spyOn(process, 'exit');
	expect(() => api.parse_data([{ path: '/fixture/broken.md', contents }])).toThrow(
		'Error handling broken:',
	);
	expect(exit).not.toHaveBeenCalled();
});

it('rejects invalid alias metadata without exiting', () => {
	const exit = vi.spyOn(process, 'exit');
	expect(() =>
		api.clean_html([
			{ html: '<h1>Broken</h1>', slug: 'broken', title: 'Broken', alias: 'invalid' },
		]),
	).toThrow('Aliases for broken must be an array');
	expect(exit).not.toHaveBeenCalled();
});

it('reports broken and nonreciprocal links and rejects duplicate slugs', () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const data = [
		{ slug: 'alice', html: '<a href="#bob">Bob</a><a href="#missing">Missing</a>' },
		{ slug: 'bob', html: '<h2>Bob</h2>' },
	];
	api.warn_missing_reciprocal_links(data, {});
	expect(stderr).toHaveBeenCalledWith(expect.stringContaining('missing reciprocal link from bob'));
	expect(stderr).toHaveBeenCalledWith(expect.stringContaining('links to non-existent missing'));
	expect(() => api.warn_missing_reciprocal_links([data[0], data[0]], {})).toThrow(
		'Duplicate slug: alice',
	);
	api.warn_missing_reciprocal_links(data, { include: ['alice', 'bob'] });
	expect(data[0].html).not.toContain('href="#missing"');
});

it('warns on stderr without throwing when a declared monodirectional link is absent', () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
	const data = [{ slug: 'bob', html: '<h2>Bob</h2>', monoDirectionalLinks: ['ghost'] }];

	expect(() => api.warn_missing_reciprocal_links(data, {})).not.toThrow();
	expect(stderr).toHaveBeenCalledExactlyOnceWith(
		'bob is marked as monoDirectionalLinks: ghost but no such link exists\n',
	);
	expect(stdout).not.toHaveBeenCalled();
});

it('removes excluded one-way targets from selected output while preserving link text', () => {
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const data = [
		{
			slug: 'alice',
			html: '<section id="alice"><a href="#bob">Friend <em>Bob</em></a></section>',
			monoDirectionalLinks: ['bob'],
		},
	];
	api.warn_missing_reciprocal_links(data, { include: ['alice'] });
	const $ = load(data[0].html);
	expect($('a[href="#bob"]')).toHaveLength(0);
	expect($('#alice').text()).toBe('Friend Bob');
	expect($('#alice em').text()).toBe('Bob');
});

it('reports nonexistent one-way targets in full output', () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const data = [
		{ slug: 'alice', html: '<a href="#missing">Missing</a>', monoDirectionalLinks: ['missing'] },
	];
	api.warn_missing_reciprocal_links(data, {});
	expect(stderr).toHaveBeenCalledWith(expect.stringContaining('links to non-existent missing'));
	expect(data[0].html).toContain('href="#missing"');
});

it.each([false, true])(
	'preserves present one-way targets without false reciprocity warnings (reverse link: %s)',
	(reverseLink) => {
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		const data = [
			{ slug: 'alice', html: '<a href="#bob">Bob</a>', monoDirectionalLinks: ['bob'] },
			{ slug: 'bob', html: reverseLink ? '<a href="#alice">Alice</a>' : '<h2>Bob</h2>' },
		];
		api.warn_missing_reciprocal_links(data, { include: ['alice', 'bob'] });
		expect(data[0].html).toContain('href="#bob"');
		expect(stderr).not.toHaveBeenCalled();
	},
);

it('serializes a reciprocal graph once and ignores figure links', async () => {
	const $ = load(
		'<section class="category" id="person"><section class="entry" id="alice"><h2>Alice</h2><a href="#bob">Bob</a><a href="#figure-alice">Map</a></section><section class="entry" id="bob"><h2>Bob</h2><a href="#alice">Alice</a></section></section>',
	);
	await api.generate_graph($, [], {});
	expect(graphWrite).toHaveBeenCalledWith('test.dot', expect.stringContaining('digraph G'));
	const dot = graphWrite.mock.calls[0][1];
	expect(dot).toContain('label = "Alice"');
	expect(dot.match(/->/g)).toHaveLength(1);
	expect(dot).not.toContain('figure-alice');
});

it('rejects missing graph targets with a useful diagnostic', async () => {
	const $ = load(
		'<section class="category" id="person"><section class="entry" id="alice"><h2>Alice</h2><a href="#missing">Missing</a></section></section>',
	);
	await expect(api.generate_graph($, [], {})).rejects.toThrow(
		'Graph link from alice targets missing node missing',
	);
	expect(graphWrite).not.toHaveBeenCalled();
});

it('awaits and propagates graph write failures', async () => {
	graphWrite.mockRejectedValueOnce(new Error('disk full'));
	await expect(api.generate_graph(load('<main></main>'), [], {})).rejects.toThrow('disk full');
});

it('analyzes each warning code without presentation and still transforms excluded links', () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	const entries = [
		{
			slug: 'alice',
			html: '<a href="#bob">Bob</a><a href="#gone"><em>Gone</em></a><a href="#figure-alice">Figure</a><a href="https://example.org">External</a>',
			monoDirectionalLinks: ['unused', 'gone'],
		},
		{ slug: 'bob', html: '<h2>Bob</h2>' },
	];
	expect(api.analyzeLinks(entries, { include: ['alice', 'bob'] })).toEqual([
		{ code: 'unused-one-way-link', severity: 'warning', source: 'alice', target: 'unused' },
		{ code: 'missing-reciprocal-link', severity: 'warning', source: 'alice', target: 'bob' },
		{ code: 'missing-link-target', severity: 'warning', source: 'alice', target: 'gone' },
	]);
	expect(stderr).not.toHaveBeenCalled();
	expect(entries[0].html).not.toContain('href="#gone"');
	expect(entries[0].html).toContain('<em>Gone</em>');
});

it('requires an explicit graph destination without writing a fallback', async () => {
	const $ = load('<main></main>');
	for (const options of [
		undefined,
		{},
		{ graph_file_name: '' },
		{ graph_file_name: '  ' },
		{ graph_file_name: 'bad\0path' },
	])
		await expect(api.writeGraph($, options)).rejects.toThrow('explicit graph_file_name');
	expect(graphWrite).not.toHaveBeenCalled();
	await api.writeGraph($, { graph_file_name: '/explicit/graph.dot' });
	expect(graphWrite).toHaveBeenCalledExactlyOnceWith('/explicit/graph.dot', 'digraph G {\n}\n');
});

it('uses the same graph serialization for explicit and legacy destinations', async () => {
	const $ = load(
		'<section class="category" id="person"><article class="entry" id="alice"><h2>Alice</h2><a href="#bob">Bob</a></article><article class="entry" id="bob"><h2>Bob</h2><a href="#alice">Alice</a></article></section>',
	);
	await api.generate_graph($, [], { graph_file_name: 'legacy.dot' });
	await api.writeGraph($, { graph_file_name: 'explicit.dot' });
	expect(graphWrite.mock.calls[0][1]).toBe(graphWrite.mock.calls[1][1]);
	graphWrite.mockRejectedValueOnce(new Error('disk full'));
	await expect(api.writeGraph($, { graph_file_name: 'explicit.dot' })).rejects.toThrow('disk full');
});
