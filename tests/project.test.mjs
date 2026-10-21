import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'cheerio';

const prince = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: prince }));
import { loadProject, compileProject, CompilationError } from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
	prince.mockReset().mockImplementation((_binary, args, _options, callback) => {
		void writeFile(args[3], 'fake-pdf').then(() => callback(null), callback);
	});
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
	await fixture.cleanup();
	vi.restoreAllMocks();
});
const options = () => ({
	project: fixture.project,
	theme: 'default',
	html_file_name: join(fixture.project, 'out/document.html'),
	pdf_file_name: join(fixture.project, 'out/document.pdf'),
	embedded_html_file_name: join(fixture.project, 'out/embedded.html'),
});

it('prepares a validated selected project without changing CSS or requiring Prince', async () => {
	const css = join(fixture.project, 'templates/index.css');
	await writeFile(css, 'original CSS');
	const events = [];
	const result = await loadProject(
		{ project: fixture.project, include: ['alice'] },
		{ onProgress: (event) => events.push(event) },
	);
	expect(result.entries.map(({ slug }) => slug)).toEqual(['alice']);
	expect(result.entries[0].html).not.toContain('href="#bob"');
	expect(await readFile(css, 'utf8')).toBe('original CSS');
	expect(prince).not.toHaveBeenCalled();
	await expect(readFile(options().html_file_name)).rejects.toMatchObject({ code: 'ENOENT' });
	expect(events.at(-1)).toEqual({ stage: 'sort', status: 'completed' });
});

it('compiles the reviewed baseline with titles after TOC and returns completed artifact facts', async () => {
	const events = [];
	const result = await compileProject(options(), { onProgress: (event) => events.push(event) });
	const html = await readFile(options().html_file_name, 'utf8');
	expect(html).toBe(await readFile(new URL('expected/document.html', import.meta.url), 'utf8'));
	expect(load(html)('#toc a[href="#alice"]').attr('title')).toBe('Alice');
	expect(events.filter(({ status }) => status === 'started').map(({ stage }) => stage)).toEqual([
		'discover',
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
	expect(events.filter(({ status }) => status === 'completed').map(({ stage }) => stage)).toEqual(
		events.filter(({ status }) => status === 'started').map(({ stage }) => stage),
	);
	expect(result.artifacts.map(({ kind, status }) => ({ kind, status }))).toEqual(
		['css', 'html', 'pdf', 'embedded-html'].map((kind) => ({ kind, status: 'completed' })),
	);
	for (const artifact of result.artifacts)
		expect((await readFile(artifact.path)).length).toBeGreaterThan(0);
	expect(prince).toHaveBeenCalledTimes(1);
});

it('reports selection failures before writes without claiming any artifact was created', async () => {
	await writeFile(join(fixture.project, 'templates/index.css'), 'original CSS');
	const error = await compileProject({ ...options(), include: ['ghost'] }).catch((error) => error);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('discover');
	expect(error.message).toContain('Unknown include slugs: ghost');
	expect(error.artifacts.every(({ status }) => status === 'not-started')).toBe(true);
	expect(await readFile(join(fixture.project, 'templates/index.css'), 'utf8')).toBe('original CSS');
	expect(prince).not.toHaveBeenCalled();
});

it('reports output failures conservatively, preserving the original cause and pre-existing files', async () => {
	await mkdir(join(fixture.project, 'out'));
	await writeFile(options().pdf_file_name, 'old PDF');
	await writeFile(options().embedded_html_file_name, 'old embedded');
	const cause = new Error('Prince stopped');
	prince.mockImplementationOnce((_binary, _args, _options, callback) => callback(cause));
	const error = await compileProject(options()).catch((error) => error);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('output');
	expect(error.cause).toBe(cause);
	expect(error.artifacts.map(({ status }) => status)).toEqual([
		'completed',
		'unverified',
		'unverified',
		'unverified',
	]);
	expect(await readFile(options().pdf_file_name, 'utf8')).toBe('old PDF');
	expect(await readFile(options().embedded_html_file_name, 'utf8')).toBe('old embedded');
	expect(await readFile(options().html_file_name, 'utf8')).toContain('id="alice"');
});

it('awaits Prince before reporting completion or resolving the compilation', async () => {
	let finish;
	const entered = new Promise((resolve) =>
		prince.mockImplementationOnce((_binary, args, _options, callback) => {
			finish = async () => {
				await writeFile(args[3], 'fake-pdf');
				callback(null);
			};
			resolve();
		}),
	);
	const events = [];
	let resolved = false;
	const pending = compileProject(options(), { onProgress: (event) => events.push(event) }).then(
		(result) => {
			resolved = true;
			return result;
		},
	);
	await entered;
	expect(resolved).toBe(false);
	expect(events.at(-1)).toEqual({ stage: 'output', status: 'started' });
	await finish();
	await pending;
	expect(events.at(-1)).toEqual({ stage: 'output', status: 'completed' });
});

it('distinguishes a failed CSS/render attempt from outputs that were never attempted', async () => {
	await writeFile(join(fixture.project, 'templates/index.css'), 'original CSS');
	await writeFile(join(fixture.project, 'templates/default/index.scss'), 'body { broken:');
	const error = await compileProject(options()).catch((error) => error);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('render');
	expect(error.artifacts.map(({ status }) => status)).toEqual([
		'unverified',
		'not-started',
		'not-started',
		'not-started',
	]);
	expect(await readFile(join(fixture.project, 'templates/index.css'), 'utf8')).toBe('original CSS');
	expect(prince).not.toHaveBeenCalled();
});

it('uses one validated category snapshot for sorting, rendering and the TOC', async () => {
	const result = await compileProject(options(), {
		onProgress: ({ stage, status }) => {
			if (stage === 'sort' && status === 'completed')
				writeFileSync(join(fixture.project, 'data/categories.json'), '{changed after inspection');
		},
	});
	expect(result.artifacts.every(({ status }) => status === 'completed')).toBe(true);
	const $ = load(await readFile(options().html_file_name, 'utf8'));
	expect($('#person > h1').text()).toBe('People');
	expect($('#toc a[href="#person"]').text()).toBe('People');
});

it('rejects a selected theme removed since inspection before attempting any writes', async () => {
	const loaded = await loadProject({ project: fixture.project });
	expect(loaded.themes).toContain('default');
	await writeFile(join(fixture.project, 'templates/index.css'), 'original CSS');
	await rm(join(fixture.project, 'templates/default'), { recursive: true });
	const error = await compileProject(options()).catch((error) => error);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.message).toContain('unavailable theme');
	expect(error.artifacts.every(({ status }) => status === 'not-started')).toBe(true);
	expect(await readFile(join(fixture.project, 'templates/index.css'), 'utf8')).toBe('original CSS');
	expect(prince).not.toHaveBeenCalled();
});

it('returns structured link diagnostics without stderr and emits them before later failures', async () => {
	const batches = [];
	const optionsWithSelection = { ...options(), include: ['alice'] };
	const loaded = await loadProject(optionsWithSelection, {
		onDiagnostics: (items) => batches.push(items),
	});
	expect(loaded.diagnostics).toContainEqual({
		code: 'missing-link-target',
		severity: 'warning',
		source: 'alice',
		target: 'bob',
	});
	expect(batches).toEqual([loaded.diagnostics]);
	expect(process.stderr.write).not.toHaveBeenCalled();
	prince.mockImplementation((_binary, _args, _options, callback) =>
		callback(new Error('Prince failed')),
	);
	await expect(compileProject(optionsWithSelection)).rejects.toMatchObject({
		stage: 'output',
		diagnostics: loaded.diagnostics,
	});
	expect(process.stderr.write).not.toHaveBeenCalled();
});
