import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { load } from 'cheerio';
import { output } from '../src/index.ts';
import { compile, projectFixture } from './helpers.mjs';

const exec = promisify(execFile);
it.skipIf(process.env.CROSS_DOC_TEST_PRINCE !== '1')(
	'renders the trusted fixture with real Prince and verifies PDF content and page geometry',
	async () => {
		const fixture = await projectFixture();
		try {
			const { $ } = await compile(fixture.project);
			const pdf = join(fixture.project, 'out/document.pdf');
			await output($, {
				project: fixture.project,
				html_file_name: join(fixture.project, 'out/document.html'),
				pdf_file_name: pdf,
				embedded_html_file_name: join(fixture.project, 'out/embedded.html'),
			});
			expect((await readFile(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
			expect((await stat(pdf)).size).toBeGreaterThan(1000);
			const { stdout: info } = await exec('pdfinfo', [pdf]);
			expect(info).toMatch(/Pages:\s+4\b/);
			expect(info).toMatch(/Page size:\s+595\.?\d* x 841\.?\d* pts \(A4\)/);
			const { stdout: text } = await exec('pdftotext', ['-layout', pdf, '-']);
			for (const expected of [
				'Alice',
				'Bob',
				'The expedition map',
				'Finds the way home.',
				'1st February 2020',
			])
				expect(text).toContain(expected);
			const pages = text.split('\f');
			expect(pages[0]).toContain('The expedition map');
			expect(pages[1]).toContain('The journey begins.');
			expect(pages[2]).toContain('Hero Points');
			expect(pages[3]).toContain('1st February 2020');
			if (process.env.CROSS_DOC_PDF_ARTIFACTS) {
				const directory = resolve(process.env.CROSS_DOC_PDF_ARTIFACTS);
				await mkdir(directory, { recursive: true });
				await copyFile(pdf, join(directory, 'document.pdf'));
				await exec('pdftoppm', ['-scale-to', '1200', '-png', pdf, join(directory, 'page')]);
			}
		} finally {
			await fixture.cleanup();
		}
	},
	30000,
);

it.skipIf(process.env.CROSS_DOC_TEST_PRINCE !== '1')(
	'preserves distinct destinations for multiple figure references in real PDF output',
	async () => {
		const fixture = await projectFixture();
		try {
			const source = join(fixture.project, 'data/alice.md');
			await writeFile(
				source,
				(await readFile(source, 'utf8')).replace(
					'caption: The expedition map',
					'caption: The expedition map\n  - file: map.svg\n    caption: Another view of the map',
				),
			);
			await writeFile(
				join(fixture.project, 'templates/default/index.scss'),
				'body { font-family: sans-serif; } figure { break-before: page; } img { max-width: 100%; } @page { size: A4; margin: 15mm; }',
			);
			const { $ } = await compile(fixture.project);
			const pdf = join(fixture.project, 'out/figures.pdf');
			await output($, {
				project: fixture.project,
				html_file_name: join(fixture.project, 'out/figures.html'),
				pdf_file_name: pdf,
				embedded_html_file_name: join(fixture.project, 'out/figures-complete.html'),
			});
			const { stdout } = await exec('pdftohtml', ['-stdout', '-i', '-s', pdf]);
			const rendered = load(stdout);
			const normalize = (node) => rendered(node).text().replace(/\s+/g, ' ').trim();
			const destinations = [];
			for (const [number, caption] of [
				[1, 'The expedition map'],
				[2, 'Another view of the map'],
			]) {
				const reference = rendered('a').filter(
					(_, node) => normalize(node) === `See fig. ${number}`,
				);
				expect(reference).toHaveLength(1);
				const destination = reference.attr('href').split('#').at(-1);
				const captionElement = rendered('p').filter(
					(_, node) => normalize(node) === `fig. ${number} ${caption}`,
				);
				expect(captionElement).toHaveLength(1);
				expect(captionElement.closest('div[id]').attr('id')).toBe(`page${destination}-div`);
				const toc = rendered('a').filter((_, node) =>
					normalize(node).startsWith(`fig. ${number} ${caption}`),
				);
				expect(toc).toHaveLength(1);
				expect(toc.attr('href')).toBe(reference.attr('href'));
				destinations.push(destination);
			}
			expect(new Set(destinations).size).toBe(2);
		} finally {
			await fixture.cleanup();
		}
	},
	30000,
);
