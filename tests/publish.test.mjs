import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	link,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from 'cheerio';
const prince = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: prince }));
import { publishProject, CompilationError } from '../src/index.ts';
import { vaultFixture } from './vault-fixture.mjs';
import { projectFixture } from './helpers.mjs';

let fixture, output;
const file = (name = 'book.html') => join(output, name);
const options = (extra = {}) => ({
	project: fixture.project,
	theme: 'default',
	outputs: { html: { path: file() } },
	intermediates: { directory: file('staging') },
	...extra,
});
const write = async (path, content) => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
};
const absent = async (path) => expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
const assertClean = async (result) => {
	for (const artifact of result.artifacts.filter((a) => a.role === 'intermediate')) {
		expect(artifact.cleanup).toBe('removed');
		await absent(artifact.path);
	}
	expect(
		await readdir(file('staging')).catch((error) => {
			if (error.code === 'ENOENT') return [];
			throw error;
		}),
	).toEqual([]);
};
beforeEach(async () => {
	fixture = await vaultFixture();
	output = await mkdtemp(join(tmpdir(), 'cross-doc-publish-output-'));
	prince
		.mockReset()
		.mockImplementation(
			(_binary, args, _opts, callback) =>
				void writeFile(args[3], '%PDF-fake').then(() => callback(null), callback),
		);
});
afterEach(async () => {
	await fixture.cleanup();
	await rm(output, { recursive: true, force: true });
});

it('publishes self-contained HTML by default without invoking Prince and cleans temporary files', async () => {
	const events = [];
	const result = await publishProject(options(), { onProgress: (event) => events.push(event) });
	const $ = load(await readFile(file(), 'utf8'));
	expect($('img').attr('src')).toMatch(/^data:image\/svg\+xml;base64,/);
	expect($('link[rel=stylesheet]').attr('href')).toMatch(/^data:text\/css;base64,/);
	expect(prince).not.toHaveBeenCalled();
	expect(result.artifacts.filter((a) => a.role === 'deliverable')).toEqual([
		{ kind: 'embedded-html', path: file(), status: 'completed', role: 'deliverable' },
	]);
	const started = events.filter((e) => e.status === 'started').map((e) => e.stage);
	expect(new Set(started).size).toBe(started.length);
	expect(events.filter((e) => e.status === 'completed').map((e) => e.stage)).toEqual(started);
	await assertClean(result);
	await absent(join(fixture.project, 'publishing/index.css'));
});

it('publishes PDF only, passes Prince controls and leaves only the requested deliverable', async () => {
	const result = await publishProject(
		options({
			outputs: { pdf: { path: file('book.pdf'), princeBinary: 'custom prince' } },
			intermediates: undefined,
		}),
	);
	expect(await readFile(file('book.pdf'), 'utf8')).toBe('%PDF-fake');
	expect(await readdir(output)).toEqual(['book.pdf']);
	const call = prince.mock.calls[0];
	expect(call[0]).toBe('custom prince');
	expect(call[1][0]).toBe('--no-network');
	expect(call[2]).toMatchObject({ timeout: 30000, maxBuffer: 31457280, windowsHide: true });
	expect(result.artifacts.filter((a) => a.role === 'deliverable').map((a) => a.kind)).toEqual([
		'pdf',
	]);
	await assertClean(result);
});

it.each(['embedded', 'linked'])(
	'publishes both formats with independent PDF and %s HTML destinations',
	async (format) => {
		const result = await publishProject(
			options({
				outputs: {
					html: { path: file('html/book.html'), format },
					pdf: { path: file('pdf/book.pdf') },
				},
			}),
		);
		expect(await readFile(file('pdf/book.pdf'), 'utf8')).toBe('%PDF-fake');
		expect(
			result.artifacts
				.filter((a) => a.role === 'deliverable')
				.every((a) => a.status === 'completed'),
		).toBe(true);
		const rendered = load(await readFile(file('html/book.html'), 'utf8'));
		expect(rendered('img').attr('src')).toMatch(
			format === 'embedded' ? /^data:/ : /^book.assets\//,
		);
		await assertClean(result);
	},
);

it('copies linked images, attachments and CSS into a movable companion folder with no vault paths', async () => {
	await write(
		join(fixture.project, 'notes/alice.md'),
		'---\ntype: person\ntitle: Alice\n---\n# Alice\n\n![Map](../attachments/map.svg "Map")\n\n![Map again](../attachments/map.svg "Again")\n\n[Download](../attachments/map.svg#symbol)',
	);
	await write(
		join(fixture.project, 'publishing/themes/default/index.scss'),
		'body {background:url("../../../attachments/map.svg")}',
	);
	const result = await publishProject(
		options({ outputs: { html: { path: file(), format: 'linked' } } }),
	);
	const before = await readFile(file(), 'utf8');
	expect(before).not.toContain(fixture.project);
	expect(before).not.toMatch(/(?:\.\.\/attachments|file:\/\/)/);
	const $ = load(before);
	const images = $('img')
		.map((_i, n) => $(n).attr('src'))
		.get();
	expect(images[0]).toBe(images[1]);
	expect(
		$('a')
			.filter((_i, n) => $(n).text() === 'Download')
			.attr('href'),
	).toBe(`${images[0]}#symbol`);
	expect(result.artifacts.find((a) => a.kind === 'assets')).toMatchObject({
		path: file('book.assets'),
		status: 'completed',
	});
	await rename(file(), file('relocated/book.html')).catch(async (error) => {
		if (error.code !== 'ENOENT') throw error;
		await mkdir(file('relocated'));
		await rename(file(), file('relocated/book.html'));
	});
	await rename(file('book.assets'), file('relocated/book.assets'));
	await rm(fixture.project, { recursive: true, force: true });
	for (const n of $('img,link[rel=stylesheet]').toArray()) {
		const reference = $(n).attr(n.tagName === 'img' ? 'src' : 'href');
		const bytes = await readFile(resolve(file('relocated'), decodeURIComponent(reference)));
		expect(bytes.length).toBeGreaterThan(0);
		if (n.tagName === 'link') expect(bytes.toString()).toContain('data:image/svg+xml;base64,');
	}
});

it('supports legacy projects in the new API without writing templates/index.css', async () => {
	await fixture.cleanup();
	fixture = await projectFixture();
	await write(join(fixture.project, 'templates/index.css'), 'original CSS');
	const result = await publishProject(options());
	expect(await readFile(join(fixture.project, 'templates/index.css'), 'utf8')).toBe('original CSS');
	const $ = load(await readFile(file(), 'utf8'));
	expect($('img').attr('src')).toMatch(/^data:image\/svg\+xml;base64,/);
	expect($('link').attr('href')).toMatch(/^data:text\/css;base64,/);
	expect($('.entry').first().attr('id')).toBe('alice');
	await assertClean(result);
});

it('supports explicit CSS/HTML intermediates, retains them only on request and never removes their parent', async () => {
	const intermediate = {
		directory: file('staging'),
		cssFile: file('debug/theme.css'),
		htmlFile: file('debug/print.html'),
		keep: true,
	};
	await write(file('debug/keep.txt'), 'unrelated');
	const result = await publishProject(
		options({ outputs: { pdf: { path: file('book.pdf') } }, intermediates: intermediate }),
	);
	expect(await readFile(intermediate.cssFile, 'utf8')).toContain('font-family');
	expect(await readFile(intermediate.htmlFile, 'utf8')).toContain('data:text/css;base64,');
	expect(
		result.artifacts
			.filter((a) => a.role === 'intermediate')
			.every((a) => a.cleanup === 'retained'),
	).toBe(true);
	expect(await readFile(file('debug/keep.txt'), 'utf8')).toBe('unrelated');
	expect(await readdir(file('staging'))).toEqual([]);
});

it('removes explicit intermediates after success without deleting unrelated files', async () => {
	await write(file('debug/keep.txt'), 'keep');
	const opts = options({
		outputs: { pdf: { path: file('book.pdf') } },
		intermediates: {
			directory: file('staging'),
			cssFile: file('debug/theme.css'),
			htmlFile: file('debug/print.html'),
		},
	});
	const result = await publishProject(opts);
	await assertClean(result);
	expect(await readFile(file('debug/keep.txt'), 'utf8')).toBe('keep');
});

it('reports completed HTML and attempted partial PDF independently when Prince fails', async () => {
	const cause = new Error('Prince failed');
	prince.mockImplementation(
		(_binary, args, _opts, callback) =>
			void writeFile(args[3], 'partial').then(() => callback(cause), callback),
	);
	const error = await publishProject(
		options({ outputs: { html: { path: file() }, pdf: { path: file('book.pdf') } } }),
	).catch((e) => e);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('output');
	expect(error.cause).toBe(cause);
	expect(error.artifacts.find((a) => a.kind === 'embedded-html')).toMatchObject({
		status: 'completed',
	});
	expect(error.artifacts.find((a) => a.kind === 'pdf')).toMatchObject({ status: 'unverified' });
	expect(await readFile(file('book.pdf'), 'utf8')).toBe('partial');
	await assertClean(error);
});

it('does not claim a PDF is complete when Prince succeeds without writing it', async () => {
	prince.mockImplementation((_b, _a, _o, callback) => callback(null));
	await expect(
		publishProject(options({ outputs: { pdf: { path: file('book.pdf') } } })),
	).rejects.toMatchObject({
		stage: 'output',
		message: 'Prince did not produce a PDF file',
		artifacts: expect.arrayContaining([
			expect.objectContaining({ kind: 'pdf', status: 'unverified' }),
		]),
	});
});

it('cleans render failures and reports unattempted deliverables', async () => {
	await write(join(fixture.project, 'publishing/themes/default/index.scss'), 'body { broken:');
	const error = await publishProject(options()).catch((e) => e);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('render');
	expect(error.artifacts.find((a) => a.role === 'deliverable').status).toBe('not-started');
	await assertClean(error);
	expect(prince).not.toHaveBeenCalled();
});

it('preserves diagnostics and cause snapshots after failed publication', async () => {
	prince.mockImplementation((_b, _a, _o, callback) => callback(new Error('missing Prince')));
	const error = await publishProject(
		options({ include: ['notes/alice'], outputs: { pdf: { path: file('book.pdf') } } }),
	).catch((e) => e);
	expect(error.diagnostics.length).toBeGreaterThan(0);
	expect(error.cause.message).toBe('missing Prince');
	expect(error.artifacts.find((a) => a.kind === 'css').cleanup).toBe('removed');
});

it.each([
	['none', {}],
	['null HTML', { html: null }],
	['unknown format', { html: { path: 'book.html', format: 'bogus' } }],
	['assets on embedded', { html: { path: 'book.html', assetsDirectory: 'assets' } }],
	['unknown output', { text: { path: 'book.txt' } }],
])('rejects invalid output selection %s before any writes', async (_name, outputs) => {
	const error = await publishProject(options({ outputs })).catch((e) => e);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('discover');
	expect(error.artifacts).toEqual([]);
	expect(await readdir(output)).toEqual([]);
});

it.each([
	'notes/book.html',
	'attachments/book.html',
	'publishing/book.html',
	'artwork/book.html',
	'drafts/book.html',
	'.obsidian/book.html',
	'book.html',
])('protects source folder destination %s', async (path) => {
	const error = await publishProject(
		options({ outputs: { html: { path: join(fixture.project, path) } } }),
	).catch((e) => e);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.stage).toBe('render');
	expect(error.artifacts.every((a) => a.status === 'not-started')).toBe(true);
	expect(await readdir(output)).toEqual([]);
	expect(prince).not.toHaveBeenCalled();
});

it('protects source destinations through existing symlink ancestors and hard-linked files', async () => {
	await symlink(join(fixture.project, 'notes'), file('alias'));
	await expect(
		publishProject(options({ outputs: { html: { path: file('alias/new/book.html') } } })),
	).rejects.toThrow('overlaps project sources');
	await link(join(fixture.project, 'notes/alice.md'), file());
	await expect(publishProject(options({ overwrite: true }))).rejects.toThrow('Hard-linked output');
});

it('allows a dedicated exports directory within the vault', async () => {
	const path = join(fixture.project, 'exports/book.html');
	const result = await publishProject(options({ outputs: { html: { path } } }));
	expect(result.artifacts.find((a) => a.role === 'deliverable').status).toBe('completed');
	expect(await readFile(path, 'utf8')).toContain('Alice');
});

it.each(['same path', 'asset parent', 'same intermediates', 'portable collision'])(
	'rejects overlapping publication paths: %s',
	async (scenario) => {
		let opts;
		if (scenario === 'same path')
			opts = options({ outputs: { html: { path: file() }, pdf: { path: file() } } });
		if (scenario === 'asset parent')
			opts = options({
				outputs: { html: { path: file(), format: 'linked', assetsDirectory: output } },
			});
		if (scenario === 'same intermediates')
			opts = options({ intermediates: { cssFile: file('same'), htmlFile: file('same') } });
		if (scenario === 'portable collision')
			opts = options({
				outputs: { html: { path: file('Book.html') }, pdf: { path: file('book.HTML') } },
			});
		await expect(publishProject(opts)).rejects.toThrow(/overlap/);
		expect(prince).not.toHaveBeenCalled();
	},
);

it('rejects stale output unless overwrite is requested and never overwrites existing intermediates', async () => {
	await write(file(), 'old HTML');
	await expect(publishProject(options())).rejects.toThrow('already exists');
	expect(await readFile(file(), 'utf8')).toBe('old HTML');
	await publishProject(options({ overwrite: true }));
	expect(await readFile(file(), 'utf8')).toContain('Alice');
	await write(file('debug.css'), 'existing intermediate');
	await expect(
		publishProject(options({ overwrite: true, intermediates: { cssFile: file('debug.css') } })),
	).rejects.toThrow('already exists');
	expect(await readFile(file('debug.css'), 'utf8')).toBe('existing intermediate');
});

it('reuses safe companion files on overwrite without deleting unrelated content', async () => {
	const opts = options({ outputs: { html: { path: file(), format: 'linked' } } });
	await publishProject(opts);
	await write(file('book.assets/keep.txt'), 'keep');
	await publishProject({ ...opts, overwrite: true });
	expect(await readFile(file('book.assets/keep.txt'), 'utf8')).toBe('keep');
});

it('rejects companion-file symlinks without modifying their targets', async () => {
	const opts = options({ outputs: { html: { path: file(), format: 'linked' } } });
	await publishProject(opts);
	const asset = (await readdir(file('book.assets'))).find((n) => n.endsWith('.svg'));
	const target = join(fixture.project, 'attachments/map.svg');
	const before = await readFile(target);
	await rm(file(`book.assets/${asset}`));
	await symlink(target, file(`book.assets/${asset}`));
	await expect(publishProject({ ...opts, overwrite: true })).rejects.toThrow(
		'Unsafe existing companion asset',
	);
	expect(await readFile(target)).toEqual(before);
});

it('handles spaces, percent signs and Unicode in companion/output paths', async () => {
	const path = file('résumé 100%/résumé 100%.html');
	await publishProject(options({ outputs: { html: { path, format: 'linked' } } }));
	const $ = load(await readFile(path, 'utf8'));
	const reference = $('img').attr('src');
	expect(reference).toContain('r%C3%A9sum%C3%A9%20100%25.assets/');
	expect(
		(await readFile(resolve(dirname(path), decodeURIComponent(reference)))).length,
	).toBeGreaterThan(0);
});

it('cleans preparation failures without creating a staging directory', async () => {
	await expect(publishProject(options({ include: ['ghost'] }))).rejects.toMatchObject({
		artifacts: [],
	});
	expect(await readdir(output)).toEqual([]);
});

it('preserves image query strings and symbol fragments in copied linked assets', async () => {
	await write(
		join(fixture.project, 'notes/alice.md'),
		'---\ntype: person\ntitle: Alice\n---\n# Alice\n\n![Map](../attachments/map.svg?version=2#symbol "Map")',
	);
	await publishProject(options({ outputs: { html: { path: file(), format: 'linked' } } }));
	const $ = load(await readFile(file(), 'utf8'));
	expect($('img').attr('src')).toMatch(/\.svg\?version=2#symbol$/);
});

it.each(['css', 'html', 'staging'])(
	'rejects %s intermediates under source folders before any generated writes',
	async (kind) => {
		const original = await readFile(join(fixture.project, 'publishing/themes/default/index.scss'));
		const intermediates =
			kind === 'css'
				? { cssFile: join(fixture.project, 'publishing/new.css') }
				: kind === 'html'
					? { htmlFile: join(fixture.project, 'notes/new.html') }
					: { directory: join(fixture.project, 'attachments') };
		await expect(publishProject(options({ intermediates }))).rejects.toThrow(
			'overlaps project sources',
		);
		expect(await readFile(join(fixture.project, 'publishing/themes/default/index.scss'))).toEqual(
			original,
		);
		expect(await readdir(output)).toEqual([]);
		expect(prince).not.toHaveBeenCalled();
	},
);

it('rechecks output ancestors before writing if they change during rendering', async () => {
	await mkdir(file('switch'));
	const { symlinkSync, rmSync } = await import('node:fs');
	const error = await publishProject(
		options({ outputs: { html: { path: file('switch/book.html') } } }),
		{
			onProgress: (event) => {
				if (event.stage === 'output' && event.status === 'started') {
					rmSync(file('switch'), { recursive: true });
					symlinkSync(join(fixture.project, 'notes'), file('switch'));
				}
			},
		},
	).catch((e) => e);
	expect(error).toBeInstanceOf(CompilationError);
	expect(error.message).toContain('overlaps project sources');
	expect(error.artifacts.find((a) => a.role === 'deliverable').status).toBe('not-started');
	await absent(join(fixture.project, 'notes/book.html'));
	await assertClean(error);
});

it('reports invalid output parent kinds without running Prince or touching stale outputs', async () => {
	await write(file('not-a-directory'), 'keep');
	await expect(
		publishProject(options({ outputs: { pdf: { path: file('not-a-directory/book.pdf') } } })),
	).rejects.toMatchObject({ stage: 'render' });
	expect(await readFile(file('not-a-directory'), 'utf8')).toBe('keep');
	expect(prince).not.toHaveBeenCalled();
});

it('pins intermediate symlink ancestors so cleanup cannot follow a changed alias into source files', async () => {
	await mkdir(file('debug'));
	await symlink(file('debug'), file('alias'));
	const source = join(fixture.project, 'notes/theme.css');
	await write(source, 'source stays intact');
	const { rmSync, symlinkSync } = await import('node:fs');
	const result = await publishProject(
		options({ intermediates: { directory: file('staging'), cssFile: file('alias/theme.css') } }),
		{
			onProgress: (event) => {
				if (event.stage === 'output' && event.status === 'started') {
					rmSync(file('alias'));
					symlinkSync(join(fixture.project, 'notes'), file('alias'));
				}
			},
		},
	);
	expect(await readFile(source, 'utf8')).toBe('source stays intact');
	await absent(file('debug/theme.css'));
	await assertClean(result);
});

it('retains the owned staging directory when default intermediate paths are kept', async () => {
	const result = await publishProject(
		options({
			outputs: { pdf: { path: file('book.pdf') } },
			intermediates: { directory: file('staging'), keep: true },
		}),
	);
	for (const artifact of result.artifacts.filter((a) => a.role === 'intermediate')) {
		expect(artifact.cleanup).toBe('retained');
		expect((await readFile(artifact.path)).length).toBeGreaterThan(0);
	}
	expect(await readdir(file('staging'))).toHaveLength(1);
});
