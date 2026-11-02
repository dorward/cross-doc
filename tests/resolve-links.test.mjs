import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { load } from 'cheerio';

const prince = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: prince }));
import * as api from '../src/index.ts';
import { idHref } from '../src/project_index.ts';
import { vaultFixture } from './vault-fixture.mjs';
import { projectFixture } from './helpers.mjs';

let fixture;
const note = async (path, body = '', metadata = {}) => {
	const file = join(fixture.project, path);
	const title = metadata.title ?? basename(path, '.md');
	await mkdir(dirname(file), { recursive: true });
	await writeFile(
		file,
		`---\n${JSON.stringify({ type: 'person', title, ...metadata })}\n---\n# ${title}\n\n${body}\n`,
	);
};
const entry = (result, identity = 'notes/alice') =>
	result.entries.find((item) => item.slug === identity);
const anchor = (document, label) => {
	const $ = load(document.html);
	return $('a').filter((_i, element) => $(element).text() === label);
};
const codes = (result) => result.diagnostics.map((item) => item.code);
const publish = async (include) => {
	const project = fixture.project;
	const options = {
		project,
		theme: 'default',
		html_file_name: join(project, 'out/book.html'),
		pdf_file_name: join(project, 'out/book.pdf'),
		embedded_html_file_name: join(project, 'out/embedded.html'),
		...(include ? { include } : {}),
	};
	const result = await api.compileProject(options);
	return { ...result, html: load(await readFile(options.html_file_name, 'utf8')) };
};
beforeEach(async () => {
	fixture = await vaultFixture();
	fixture.mappings.figures = [];
	await writeFile(
		join(fixture.project, 'publishing/legacy-links.json'),
		JSON.stringify(fixture.mappings),
	);
	for (const name of ['alice', 'bob', 'arrival', 'departure'])
		await note(`notes/${name}.md`, '', { title: name[0].toUpperCase() + name.slice(1) });
	prince
		.mockReset()
		.mockImplementation(
			(_binary, args, _options, callback) =>
				void writeFile(args[3], 'fake PDF').then(() => callback(null), callback),
		);
});
afterEach(async () => fixture.cleanup());

it('resolves inline/reference Markdown, extensionless targets and Wikilinks to the same entry', async () => {
	await note(
		'notes/alice.md',
		'[inline](bob.md) [reference][b] [no-ext](bob) [[notes/bob|wiki]] [[notes/bob.md|wiki-ext]] [[bob]]\n\n[b]: bob.md',
	);
	const original = await readFile(join(fixture.project, 'notes/alice.md'), 'utf8');
	const result = await api.loadProject({ project: fixture.project });
	for (const label of ['inline', 'reference', 'no-ext', 'wiki', 'wiki-ext', 'bob']) {
		expect(anchor(entry(result), label).attr('href')).toBe('#entry/notes/bob');
		expect(anchor(entry(result), label).attr('data-cross-doc-target')).toBe('notes/bob');
	}
	expect(result.diagnostics.filter((item) => item.code === 'missing-reciprocal-link')).toHaveLength(
		1,
	);
	expect(entry(result).__content).toContain('[reference][b]');
	expect(await readFile(join(fixture.project, 'notes/alice.md'), 'utf8')).toBe(original);
});
it('uses source-relative Markdown and exact vault, relative and unique-shortened Wikilinks', async () => {
	await note(
		'notes/places/start.md',
		'[relative](../bob.md) [[notes/bob|root]] [[../bob|wiki-relative]] [[bob|short]] [[history/arrival|suffix]]',
	);
	await note('notes/history/arrival.md', '');
	const result = await api.loadProject({ project: fixture.project });
	for (const label of ['relative', 'root', 'wiki-relative', 'short'])
		expect(anchor(entry(result, 'notes/places/start'), label).attr('href')).toBe(
			'#entry/notes/bob',
		);
	expect(anchor(entry(result, 'notes/places/start'), 'suffix').attr('href')).toBe(
		'#entry/notes/history/arrival',
	);
	expect(codes(result)).not.toContain('missing-link-target');
});
it('reports ambiguous shortened Wikilinks with candidates and never guesses global Markdown basenames', async () => {
	await note('notes/history/bob.md');
	await note(
		'notes/places/start.md',
		'[[bob|ambiguous]] [relative](bob.md) [[notes/history/bob|qualified]]',
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(result.diagnostics).toContainEqual({
		code: 'ambiguous-link-target',
		severity: 'warning',
		source: 'notes/places/start',
		target: 'bob',
		candidates: ['notes/bob.md', 'notes/history/bob.md'],
	});
	expect(result.diagnostics).toContainEqual({
		code: 'missing-link-target',
		severity: 'warning',
		source: 'notes/places/start',
		target: 'notes/places/bob',
	});
	expect(anchor(entry(result, 'notes/places/start'), 'ambiguous')).toHaveLength(0);
	expect(anchor(entry(result, 'notes/places/start'), 'qualified').attr('href')).toBe(
		'#entry/notes/history/bob',
	);
	expect(load(entry(result, 'notes/places/start').html).text()).toContain(
		'ambiguous relative qualified',
	);
});
it('gives exact same-folder Wikilinks precedence but never resolves them through metadata aliases', async () => {
	await note('notes/history/bob.md');
	fixture.mappings.entries.push({ legacySlug: 'old-name', target: 'notes/bob' });
	await writeFile(
		join(fixture.project, 'publishing/legacy-links.json'),
		JSON.stringify(fixture.mappings),
	);
	await note('notes/alice.md', '[[bob|local]] [[old-name|not-an-alias]] [legacy](#old-name)');
	const result = await api.loadProject({ project: fixture.project });
	expect(anchor(entry(result), 'local').attr('href')).toBe('#entry/notes/bob');
	expect(anchor(entry(result), 'not-an-alias')).toHaveLength(0);
	expect(anchor(entry(result), 'legacy').attr('href')).toBe('#entry/notes/bob');
	expect(codes(result)).toContain('legacy-reference');
});
it('normalizes heading links and keeps IDs while downgrading headings', async () => {
	await note(
		'notes/bob.md',
		'## Background\n\n### Details\n\n#### Depth four\n\n[return](alice.md)',
	);
	await note(
		'notes/alice.md',
		'[markdown](bob.md#Background) [[notes/bob#Background|wiki]] [details](bob.md#Details)',
	);
	const result = await publish();
	const expected = '#heading/notes/bob/Background/1';
	for (const label of ['markdown', 'wiki']) {
		const link = result.html('a').filter((_i, element) => result.html(element).text() === label);
		expect(link.attr('href')).toBe(expected);
		expect(link.attr('title')).toBe('Background');
	}
	expect(result.html('[id="heading/notes/bob/Background/1"]').prop('tagName')).toBe('H3');
	expect(result.html('[id="heading/notes/bob/Details/1"]').prop('tagName')).toBe('H4');
	expect(result.html('[id="heading/notes/bob/Depth%20four/1"]').prop('tagName')).toBe('H5');
	expect(result.diagnostics).toEqual([]);
	await api.writeGraph(result.html, { graph_file_name: join(fixture.project, 'out/graph.dot') });
	const graph = await readFile(join(fixture.project, 'out/graph.dot'), 'utf8');
	expect(graph).toContain('"entry/notes/alice" -> "entry/notes/bob"');
	expect(graph).not.toContain('"heading/');
});
it('keeps identical heading names unique across notes and resolves title/same-note links', async () => {
	await note(
		'notes/alice.md',
		'## History\n\n[[#History|here]] [[notes/bob#History|there]] [[notes/bob#Bob|title]]',
	);
	await note('notes/bob.md', '## History');
	const result = await publish();
	expect(result.html('[id="heading/notes/alice/History/1"]')).toHaveLength(1);
	expect(result.html('[id="heading/notes/bob/History/1"]')).toHaveLength(1);
	expect(result.html('a[href="#heading/notes/alice/History/1"]').text()).toBe('here');
	expect(
		result
			.html('a[href="#entry/notes/bob"]')
			.filter((_i, element) => result.html(element).text() === 'title'),
	).toHaveLength(1);
	const ids = result
		.html('[id]')
		.toArray()
		.map((element) => result.html(element).attr('id'));
	expect(new Set(ids).size).toBe(ids.length);
});
it('supports hierarchical heading qualification and diagnoses repeated unqualified headings', async () => {
	await note('notes/bob.md', '## Early\n\n### History\n\n## Late\n\n### History');
	await note(
		'notes/alice.md',
		'[[notes/bob#History|ambiguous]] [[notes/bob#Early#History|early]] [[notes/bob#Late#History|late]]',
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(
		result.diagnostics.find((item) => item.code === 'ambiguous-link-target').candidates,
	).toEqual(['notes/bob.md#bob#Early#History [1]', 'notes/bob.md#bob#Late#History [2]']);
	expect(anchor(entry(result), 'ambiguous')).toHaveLength(0);
	expect(anchor(entry(result), 'early').attr('href')).toBe('#heading/notes/bob/History/1');
	expect(anchor(entry(result), 'late').attr('href')).toBe('#heading/notes/bob/History/2');
});
it('indexes source punctuation and inline heading markup before smart typography', async () => {
	await note('notes/bob.md', '## What\'s **new** &amp; "old"?\n\n## C# / guide');
	await note(
		'notes/alice.md',
		`[[notes/bob#What's new & "old"?|wiki]] [markdown](bob.md#What's%20new%20%26%20%22old%22%3F) [hash](bob.md#C%23%20%2F%20guide)`,
	);
	const result = await api.loadProject({ project: fixture.project });
	const id = 'heading/notes/bob/' + encodeURIComponent('What\'s new & "old"?') + '/1';
	expect(anchor(entry(result), 'wiki').attr('href')).toBe(idHref(id));
	expect(anchor(entry(result), 'markdown').attr('href')).toBe(idHref(id));
	expect(anchor(entry(result), 'hash').attr('href')).toBe(
		idHref('heading/notes/bob/' + encodeURIComponent('C# / guide') + '/1'),
	);
	expect(codes(result)).not.toContain('missing-heading-target');
});
it('decodes Markdown URLs once while treating Wikilink percent signs as literal filename text', async () => {
	const name = 'Café 100%';
	await note(`notes/${name}.md`, '## A & B');
	await note(
		'notes/alice.md',
		`[url](${encodeURIComponent(name)}.md#A%20%26%20B) [[notes/${name}#A & B|wiki]]`,
	);
	const result = await api.loadProject({ project: fixture.project });
	const href = idHref(`heading/notes/${encodeURIComponent(name)}/A%20%26%20B/1`);
	expect(anchor(entry(result), 'url').attr('href')).toBe(href);
	expect(anchor(entry(result), 'wiki').attr('href')).toBe(href);
	expect(codes(result)).not.toContain('unsupported-link-syntax');
});
it('preserves code, escaped brackets, raw code and HTML comments without resolving examples', async () => {
	await note(
		'notes/alice.md',
		'`[[missing]]` and `[bad](missing.md)`\n\n```md\n![[not-an-embed]]\n[bad](missing.md)\n```\n\n<code>[[also-not-a-link]]</code>\n\n<pre><a href="#literal">literal code</a></pre>\n\n<!-- [[not-a-link]] -->\n\n\\[[escaped]]',
	);
	const result = await api.loadProject({ project: fixture.project });
	const $ = load(entry(result).html);
	expect($('code').text()).toContain('[[missing]]');
	expect($('code').text()).toContain('![[not-an-embed]]');
	expect($('a').not('pre a,code a')).toHaveLength(0);
	expect(result.diagnostics).toEqual([]);
});
it('parses escaped Wikilink aliases in Markdown tables without breaking cell boundaries', async () => {
	await note('notes/alice.md', '| Person |\n| --- |\n| [[notes/bob\\|Rob]] |');
	const result = await api.loadProject({ project: fixture.project });
	const $ = load(entry(result).html);
	expect($('tbody tr')).toHaveLength(1);
	expect($('tbody td')).toHaveLength(1);
	expect($('td a').text()).toBe('Rob');
	expect($('td a').attr('href')).toBe('#entry/notes/bob');
});
it('preserves labels and inline markup while unwrapping excluded note and heading links', async () => {
	await note('notes/bob.md', '## Background');
	await note(
		'notes/alice.md',
		'[**bold**](bob.md) [[notes/bob#Background|heading]] [missing](ghost.md)',
		{ monoDirectionalLinks: ['notes/bob', 'notes/ghost'] },
	);
	const result = await api.loadProject({ project: fixture.project, include: ['notes/alice'] });
	expect(result.diagnostics.filter((item) => item.code === 'excluded-link-target')).toEqual([
		{
			code: 'excluded-link-target',
			severity: 'warning',
			source: 'notes/alice',
			target: 'notes/bob',
		},
	]);
	expect(result.diagnostics).toContainEqual({
		code: 'missing-link-target',
		severity: 'warning',
		source: 'notes/alice',
		target: 'notes/ghost',
	});
	expect(codes(result)).not.toContain('unused-one-way-link');
	expect(codes(result)).not.toContain('missing-heading-target');
	expect(load(entry(result).html)('a')).toHaveLength(0);
	expect(load(entry(result).html)('strong').text()).toBe('bold');
	expect(load(entry(result).html).text()).toContain('bold heading missing');
});
it('treats heading links as note relationships for one-way declarations and reciprocal checks', async () => {
	await note('notes/bob.md', '## Background');
	await note('notes/alice.md', '[[notes/bob#Background|heading]]', {
		monoDirectionalLinks: ['notes/bob'],
	});
	const result = await api.loadProject({ project: fixture.project });
	expect(result.diagnostics).toEqual([]);
});
it('diagnoses missing headings separately and does not hide their owning-note one-way usage', async () => {
	await note('notes/alice.md', '[missing](bob.md#Absent)', { monoDirectionalLinks: ['notes/bob'] });
	const result = await api.loadProject({ project: fixture.project });
	expect(result.diagnostics).toEqual([
		{
			code: 'missing-heading-target',
			severity: 'warning',
			source: 'notes/alice',
			target: 'notes/bob#Absent',
		},
	]);
});
it.each([
	'![[bob]]',
	'![[attachments/map.svg]]',
	'[[notes/bob#^block]]',
	'[block](bob.md#^block)',
	'[[##Heading search]]',
	'[query](bob.md?x=1)',
	'[encoded separator](bob%2Fname.md)',
	'[malformed](bob%ZZ.md)',
	'[escape](../../outside.md)',
])('reports unsupported syntax without making a misleading link: %s', async (body) => {
	await note('notes/alice.md', body);
	const result = await api.loadProject({ project: fixture.project });
	expect(codes(result)).toContain('unsupported-link-syntax');
	expect(load(entry(result).html)('a')).toHaveLength(0);
});
it('reports Markdown files outside the entry collection and escaping attachment symlinks', async () => {
	await mkdir(join(fixture.project, 'drafts'));
	await writeFile(join(fixture.project, 'drafts/report.md'), '# Not published');
	await symlink(
		new URL('./fixtures/project/data/bob.md', import.meta.url),
		join(fixture.project, 'attachments/outside.md'),
	);
	await note(
		'notes/alice.md',
		'[draft](../drafts/report.md) [[drafts/report|wiki-draft]] [escape](../attachments/outside.md)',
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(result.diagnostics).toContainEqual({
		code: 'non-published-link-target',
		severity: 'warning',
		source: 'notes/alice',
		target: 'drafts/report.md',
	});
	expect(codes(result)).toContain('unsupported-link-syntax');
	expect(load(entry(result).html)('a')).toHaveLength(0);
});
it('resolves raw HTML note links and namespaced manual anchors using exact IDs', async () => {
	await note('notes/bob.md', '<span id="a.b:[q]">Manual anchor</span>');
	await note('notes/alice.md', '<a href="bob.md#a.b:[q]">raw</a>');
	const result = await publish();
	const targetId = 'anchor/notes/bob/' + encodeURIComponent('a.b:[q]') + '/1';
	expect(
		result
			.html('a')
			.filter((_i, element) => result.html(element).text() === 'raw')
			.attr('href'),
	).toBe(idHref(targetId));
	expect(
		result
			.html('[id]')
			.toArray()
			.some((element) => result.html(element).attr('id') === targetId),
	).toBe(true);
});
it('keeps external URLs intact and resolves navigational attachment links without graph edges', async () => {
	await note(
		'notes/alice.md',
		'[external](https://example.com/a?x=1#h) [mail](mailto:a@example.com) [data](data:text/plain,hello) [asset](../attachments/map.svg) [[attachments/map.svg|wiki-asset]] [[map.svg|short-asset]]',
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(anchor(entry(result), 'external').attr('href')).toBe('https://example.com/a?x=1#h');
	for (const label of ['asset', 'wiki-asset', 'short-asset'])
		expect(anchor(entry(result), label).attr('href')).toBe('attachments/map.svg');
	expect(result.diagnostics).toEqual([]);
});
it('keeps recorded legacy fragments/figures and reports collisions with local headings', async () => {
	await note('notes/alice.md', '## Bob\n\n[legacy](#bob) [[#Bob|local]] [figure](#figure-bob)');
	await note('notes/bob.md', '', { figures: [{ file: 'map.svg', caption: 'Map' }] });
	fixture.mappings.figures = [{ legacyId: 'figure-bob', target: 'notes/bob', ordinal: 1 }];
	await writeFile(
		join(fixture.project, 'publishing/legacy-links.json'),
		JSON.stringify(fixture.mappings),
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(anchor(entry(result), 'legacy').attr('href')).toBe('#entry/notes/bob');
	expect(anchor(entry(result), 'local').attr('href')).toBe('#heading/notes/alice/Bob/1');
	expect(anchor(entry(result), 'figure').attr('href')).toBe('#figure/notes/bob/1');
	expect(
		result.diagnostics.find((item) => item.code === 'ambiguous-link-target').candidates,
	).toEqual(['notes/bob', 'notes/alice.md#bob']);
});
it('provides a standalone resolver and copies candidate arrays across hooks/error snapshots', async () => {
	await note('notes/history/bob.md');
	await note('notes/places/start.md', '[[bob]]');
	const index = await api.indexProject({ project: fixture.project });
	const parsed = api.parse_data(
		await api.read_files(index.entries.map((item) => item.path)),
		index,
	);
	const resolved = await api.resolveLinks(parsed, index);
	expect(resolved.headings.length).toBeGreaterThan(0);
	expect(
		resolved.diagnostics.find((item) => item.code === 'ambiguous-link-target').candidates,
	).toHaveLength(2);
	const loaded = await api.loadProject(
		{ project: fixture.project },
		{
			onDiagnostics(items) {
				const item = items.find((diagnostic) => diagnostic.candidates);
				item.candidates.push('mutated');
			},
		},
	);
	expect(loaded.diagnostics.find((item) => item.candidates).candidates).not.toContain('mutated');
});
it('supports new link formats in legacy layouts without changing their entry IDs', async () => {
	const legacy = await projectFixture();
	try {
		await writeFile(
			join(legacy.project, 'data/bob.md'),
			'---\ntype: person\ntitle: Bob\n---\n# Bob\n\n## History\n\n[Alice](alice.md)',
		);
		await writeFile(
			join(legacy.project, 'data/alice.md'),
			'---\ntype: person\ntitle: Alice\n---\n# Alice\n\n[[bob#History|heading]]',
		);
		const events = [];
		const result = await api.loadProject(
			{ project: legacy.project },
			{ onProgress: (event) => events.push(event) },
		);
		expect(entry(result, 'alice').slug).toBe('alice');
		expect(anchor(entry(result, 'alice'), 'heading').attr('href')).toBe('#heading/bob/History/1');
		expect(anchor(entry(result, 'bob'), 'Alice').attr('href')).toBe('#alice');
		expect(events.some((event) => event.stage === 'resolve')).toBe(true);
	} finally {
		await legacy.cleanup();
	}
});

it('preserves legacy fragment-only self links and their progress sequence', async () => {
	const legacy = await projectFixture();
	try {
		await writeFile(
			join(legacy.project, 'data/alice.md'),
			'---\ntitle: Alice\ntype: person\n---\n# Alice\n\n[Self](#alice)',
		);
		const events = [];
		const loaded = await api.loadProject(
			{ project: legacy.project },
			{ onProgress: (event) => events.push(event) },
		);
		expect(events.some((event) => event.stage === 'resolve')).toBe(false);
		expect(entry(loaded, 'alice').linkResolution).toBeUndefined();
		expect(anchor(entry(loaded, 'alice'), 'Self').attr('href')).toBe('#alice');
	} finally {
		await legacy.cleanup();
	}
});
it('diagnoses ambiguous attachments and ignores broken/unrelated symlinks during bare attachment lookup', async () => {
	await mkdir(join(fixture.project, 'attachments/copies'));
	await writeFile(join(fixture.project, 'attachments/copies/map.svg'), '<svg/>');
	await symlink(
		join(fixture.project, 'attachments/missing.png'),
		join(fixture.project, 'attachments/broken.png'),
	);
	await note('notes/alice.md', '[[map.svg|ambiguous]] [[attachments/map.svg|exact]]');
	const loaded = await api.loadProject({ project: fixture.project });
	expect(loaded.diagnostics).toContainEqual({
		code: 'ambiguous-link-target',
		severity: 'warning',
		source: 'notes/alice',
		target: 'map.svg',
		candidates: ['attachments/copies/map.svg', 'attachments/map.svg'],
	});
	expect(anchor(entry(loaded), 'exact').attr('href')).toBe('attachments/map.svg');
});
it('does not count an excluded figure reference as a note-level one-way link', async () => {
	await note('notes/bob.md', '', { figures: [{ file: 'map.svg', caption: 'Map' }] });
	fixture.mappings.figures = [{ legacyId: 'figure-bob', target: 'notes/bob', ordinal: 1 }];
	await writeFile(
		join(fixture.project, 'publishing/legacy-links.json'),
		JSON.stringify(fixture.mappings),
	);
	await note('notes/alice.md', '[figure](#figure-bob)', { monoDirectionalLinks: ['notes/bob'] });
	const loaded = await api.loadProject({ project: fixture.project, include: ['notes/alice'] });
	expect(codes(loaded)).toContain('excluded-link-target');
	expect(codes(loaded)).toContain('unused-one-way-link');
});
it('preserves formatted labels when raw HTML links and heading targets are excluded', async () => {
	await note('notes/bob.md', '## Background');
	await note('notes/alice.md', '<a href="bob.md#Background"><em>Raw label</em></a>');
	const loaded = await api.loadProject({ project: fixture.project, include: ['notes/alice'] });
	expect(codes(loaded)).toContain('excluded-link-target');
	expect(load(entry(loaded).html)('em').text()).toBe('Raw label');
	expect(load(entry(loaded).html)('a')).toHaveLength(0);
});
it('retains diagnostic candidates after a later compilation error', async () => {
	await note('notes/history/bob.md');
	await note('notes/places/start.md', '[[bob]]');
	await writeFile(join(fixture.project, 'publishing/themes/default/index.scss'), 'body { broken:');
	const options = {
		project: fixture.project,
		theme: 'default',
		html_file_name: join(fixture.project, 'out/error.html'),
		pdf_file_name: join(fixture.project, 'out/error.pdf'),
		embedded_html_file_name: join(fixture.project, 'out/error-complete.html'),
	};
	const failure = await api
		.compileProject(options, {
			onDiagnostics(items) {
				items.find((item) => item.candidates).candidates.length = 0;
			},
		})
		.catch((error) => error);
	expect(failure).toBeInstanceOf(api.CompilationError);
	expect(failure.stage).toBe('render');
	expect(failure.diagnostics.find((item) => item.candidates).candidates).toEqual([
		'notes/bob.md',
		'notes/history/bob.md',
	]);
});

it('preserves additional top-level headings while keeping entry titles and graph labels singular', async () => {
	await note('notes/bob.md', '# Swords');
	await note(
		'notes/alice.md',
		'[note](bob.md) [[notes/bob#Swords|section]] [top](#) [file-top](bob.md#)',
	);
	const result = await publish();
	const noteLink = result.html('a').filter((_i, element) => result.html(element).text() === 'note');
	expect(noteLink.attr('title')).toBe('bob');
	expect(
		result
			.html('a[href="#entry/notes/bob"]')
			.filter((_i, node) => result.html(node).text() === 'file-top'),
	).toHaveLength(1);
	expect(result.html('[id="heading/notes/bob/Swords/1"]').text()).toBe('Swords');
	expect(
		result
			.html('a[href="#entry/notes/alice"]')
			.filter((_i, element) => result.html(element).text() === 'top'),
	).toHaveLength(1);
	await api.writeGraph(result.html, { graph_file_name: join(fixture.project, 'out/graph.dot') });
	expect(await readFile(join(fixture.project, 'out/graph.dot'), 'utf8')).toContain(
		'"entry/notes/bob" [label = "bob"',
	);
});
it('maps both id and name aliases on the same raw HTML anchor', async () => {
	await note('notes/bob.md', '<a id="primary" name="alternate"></a>');
	await note('notes/alice.md', '[primary](bob.md#primary) [alternate](bob.md#alternate)');
	const result = await api.loadProject({ project: fixture.project });
	expect(anchor(entry(result), 'primary').attr('href')).toBe(
		anchor(entry(result), 'alternate').attr('href'),
	);
	expect(codes(result)).not.toContain('missing-heading-target');
});

it('normalizes metadata aliases in standalone resolution without rewriting source frontmatter', async () => {
	await note('notes/alice.md', '[[notes/bob]]', { also: ['bob'], monoDirectionalLinks: ['bob'] });
	const original = await readFile(join(fixture.project, 'notes/alice.md'), 'utf8');
	const index = await api.indexProject({ project: fixture.project });
	const parsed = api.parse_data(
		await api.read_files(index.entries.map((item) => item.path)),
		index,
	);
	const result = await api.resolveLinks(parsed, index);
	expect(entry(result).also).toEqual(['notes/bob']);
	expect(entry(result).monoDirectionalLinks).toEqual(['notes/bob']);
	expect(entry(result).__content).toBe(entry({ entries: parsed }).__content);
	expect(await readFile(join(fixture.project, 'notes/alice.md'), 'utf8')).toBe(original);
});

it('resolves unambiguous case/Unicode path variants without changing canonical spelling', async () => {
	await note('notes/Café.md', '## Résumé');
	await note(
		'notes/places/start.md',
		'[case](../BOB.md) [[NOTES/BOB|wiki-case]] [[notes/Café|decomposed]] [[notes/Café#Résumé|heading-unicode]]',
	);
	const result = await api.loadProject({ project: fixture.project });
	const source = entry(result, 'notes/places/start');
	expect(anchor(source, 'case').attr('href')).toBe('#entry/notes/bob');
	expect(anchor(source, 'wiki-case').attr('href')).toBe('#entry/notes/bob');
	expect(anchor(source, 'decomposed').attr('href')).toBe(
		idHref('entry/notes/' + encodeURIComponent('Café')),
	);
	expect(anchor(source, 'heading-unicode').attr('href')).toBe(
		idHref(
			'heading/notes/' + encodeURIComponent('Café') + '/' + encodeURIComponent('Résumé') + '/1',
		),
	);
	expect(codes(result)).not.toContain('non-published-link-target');
});

it('preserves attachment viewer fragments and inline SVG rendering references', async () => {
	await writeFile(join(fixture.project, 'attachments/report.pdf'), 'fixture attachment');
	await note(
		'notes/alice.md',
		'[PDF](../attachments/report.pdf#page=2&zoom=100)\n\n<svg><defs><linearGradient id="paint"><stop offset="0%"/></linearGradient></defs><a href="#paint"><rect fill="url(#paint)"/></a></svg>',
	);
	const result = await api.loadProject({ project: fixture.project });
	expect(anchor(entry(result), 'PDF').attr('href')).toBe('attachments/report.pdf#page=2&zoom=100');
	const $ = load(entry(result).html);
	expect($('svg [id]').attr('id')).toBe('paint');
	expect($('rect').attr('fill')).toBe('url(#paint)');
	expect($('svg a').attr('href')).toBe('#paint');
	expect(result.diagnostics).toEqual([]);
	await publish();
	const embedded = load(await readFile(join(fixture.project, 'out/embedded.html'), 'utf8'));
	expect(
		embedded('a')
			.filter((_i, node) => embedded(node).text() === 'PDF')
			.attr('href'),
	).toMatch(/^data:application\/pdf;base64,.*#page=2&zoom=100$/);
});
