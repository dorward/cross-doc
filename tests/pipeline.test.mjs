import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'cheerio';

const renderer = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: renderer }));

import * as api from '../src/index.ts';
import { compile, projectFixture } from './helpers.mjs';

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
	renderer.mockReset().mockImplementation((_binary, _args, _options, callback) => callback(null));
	vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
	await fixture.cleanup();
});

const text = ($, selector) =>
	$(selector)
		.map((_, element) => $(element).text().trim())
		.get();

describe('public document pipeline', () => {
	it('exposes the complete named operation inventory', () => {
		expect(Object.keys(api).sort()).toEqual(
			[
				'add_front_matter',
				'add_table_of_contents',
				'add_title_attributes',
				'clean_html',
				'generate_graph',
				'writeGraph',
				'generate_html',
				'get_files',
				'select_files',
				'loadProject',
				'compileProject',
				'CompilationError',
				'readCategories',
				'inspectProject',
				'listThemes',
				'validateTheme',
				'analyzeLinks',
				'output',
				'parse_data',
				'read',
				'read_files',
				'replace_placeholders',
				'sort',
				'warn_missing_reciprocal_links',
			].sort(),
		);
		for (const operation of Object.values(api)) expect(operation).toBeTypeOf('function');
	});

	it('discovers Markdown recursively and filters include by slug', async () => {
		await writeFile(join(fixture.project, 'data', 'ignored.txt'), 'ignored');
		const files = await api.get_files({ project: fixture.project, include: ['alice', 'bob'] });
		expect(files.map((file) => file.split('/').pop()).sort()).toEqual(['alice.md', 'bob.md']);
		const raw = await api.read_files(files);
		expect(raw).toHaveLength(2);
		expect(
			raw.every((entry) => typeof entry.contents === 'string' && entry.path.endsWith('.md')),
		).toBe(true);
	});

	it('preserves parsing, headings, aliases, dates, links, sheets and TOC order', async () => {
		const { $, parsed } = await compile(fixture.project);
		const alice = parsed.find((entry) => entry.slug === 'alice');
		expect(alice.date).toBeInstanceOf(Date);
		expect(alice.date.toISOString()).toBe('2020-02-03T00:00:00.000Z');
		expect(load(alice.html).text()).toContain('“Hello” – meet');
		expect($('#alice > header h2').text()).toBe('Alice');
		expect($('#alice > h3').first().text()).toBe('Background');
		expect($('#alice h4').text()).toBe('Details');
		expect($('#alice > header h2').data('index')).toEqual(['Alice', 'Explorer', 'Hidden Name']);
		expect($('#alice time').attr('datetime')).toBe('2020-02-03');
		expect($('#alice time').text()).toBe('Feb 2020');
		expect($('#alice .see-also a').text()).toBe('Bob');
		expect($('#alice .see-also a').attr('title')).toBe('Bob');
		expect($('#alice .figure-link').text()).toBe('See fig. 1');
		expect(text($, '#category_person > ol > li > a')).toEqual([
			'Alice',
			'Bob',
			'Explorer',
			'Hidden Name',
		]);
		expect(text($, '#category_event > ol > li > a')).toEqual(['Departure', 'Arrival']);
		expect(text($, '#timeline > h2')).toEqual([
			'1st February 2020',
			'3rd February 2020',
			'4th February 2020',
		]);
		expect($('#sheet-alice .player').last().text()).toBe('Ada');
		expect($('#sheet-alice .notes').text()).toContain('Finds the way home.');
		expect(await readFile(join(fixture.project, 'templates/index.css'), 'utf8')).toContain(
			'color: #123456',
		);
		// Full output baseline supplements the semantic assertions above.
		await expect($.root().html()).toMatchFileSnapshot('./expected/document.html');
	});

	it('omits secret aliases and excluded see-also targets from selected output', async () => {
		const parsed = api.parse_data(await api.read_files([join(fixture.project, 'data/alice.md')]));
		const [entry] = api.add_front_matter(api.clean_html(parsed), { include: ['alice'] });
		const $ = load(entry.html);
		expect($('.aliases').text()).not.toContain('Hidden Name');
		expect($('.see-also a')).toHaveLength(0);
	});

	it('writes normal HTML, embeds actual images and CSS, and invokes Prince with limits', async () => {
		const { $ } = await compile(fixture.project);
		const options = {
			project: fixture.project,
			html_file_name: join(fixture.project, 'out/document.html'),
			pdf_file_name: join(fixture.project, 'out/document.pdf'),
			embedded_html_file_name: join(fixture.project, 'out/embedded.html'),
		};
		await api.output($, options);
		const normal = await readFile(options.html_file_name, 'utf8');
		const embedded = load(await readFile(options.embedded_html_file_name, 'utf8'));
		expect(normal).toContain('../resources/map.svg');
		const image = embedded('img').attr('src');
		expect(image).toMatch(/^data:image\/svg\+xml;base64,/);
		expect(Buffer.from(image.split(',')[1], 'base64').toString()).toContain(
			'<text x="5" y="25">Map</text>',
		);
		const css = embedded('link[rel=stylesheet]').attr('href');
		expect(css).toMatch(/^data:text\/css;base64,/);
		expect(Buffer.from(css.split(',')[1], 'base64').toString()).toContain('color: #123456');
		expect(embedded('a[href="#bob"]').length).toBeGreaterThan(0);
		expect(renderer).toHaveBeenCalledWith(
			'prince',
			['--no-network', options.html_file_name, '-o', options.pdf_file_name],
			{
				timeout: 30000,
				maxBuffer: 31457280,
				windowsHide: true,
			},
			expect.any(Function),
		);
	});

	it('rejects renderer failures and does not produce embedded output', async () => {
		renderer.mockImplementation((_binary, _args, _options, callback) =>
			callback(new Error('renderer failed'), 'renderer output', 'bad input'),
		);
		const $ = load('<p>Example</p>');
		const options = {
			project: fixture.project,
			html_file_name: join(fixture.project, 'normal.html'),
			pdf_file_name: join(fixture.project, 'result.pdf'),
			embedded_html_file_name: join(fixture.project, 'embedded.html'),
		};
		await expect(api.output($, options)).rejects.toMatchObject({
			message: 'renderer failed',
			stdout: 'renderer output',
			stderr: 'bad input',
		});
		await expect(readFile(options.embedded_html_file_name)).rejects.toMatchObject({
			code: 'ENOENT',
		});
	});

	it('rejects missing embedded assets', async () => {
		const $ = load('<img src="../resources/missing.svg">');
		await expect(
			api.output($, {
				project: fixture.project,
				html_file_name: join(fixture.project, 'normal.html'),
				pdf_file_name: join(fixture.project, 'result.pdf'),
				embedded_html_file_name: join(fixture.project, 'embedded.html'),
			}),
		).rejects.toThrow();
	});
});
