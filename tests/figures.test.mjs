import { beforeEach, afterEach, expect, it } from 'vitest';
import * as api from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
});
afterEach(async () => {
	await fixture.cleanup();
});

async function document(specs) {
	const parsed = api.parse_data(
		specs.map(([slug, count]) => ({
			path: `${slug}.md`,
			contents: `---\n${JSON.stringify({ type: 'person', title: slug, figures: Array.from({ length: count }, (_, i) => ({ file: 'map.svg', caption: `${slug} illustration ${i + 1}` })) })}\n---\n# ${slug}\n`,
		})),
	);
	const entries = api.add_front_matter(api.clean_html(parsed), {});
	const $ = await api.generate_html(entries, { project: fixture.project, theme: 'default' });
	api.replace_placeholders($);
	await api.add_table_of_contents($, { project: fixture.project });
	return $;
}
function verifyReferences($) {
	const ids = $('[id]')
		.toArray()
		.map((node) => $(node).attr('id'));
	expect(new Set(ids).size).toBe(ids.length);
	for (const anchor of $('.figure-link, #category_figures a').toArray()) {
		const target = $(anchor).attr('href').slice(1);
		expect($('figure').filter((_, node) => $(node).attr('id') === target)).toHaveLength(1);
	}
}

it('gives multiple figures distinct targets, individual reference labels and TOC links', async () => {
	const $ = await document([
		['alpha', 2],
		['beta', 1],
	]);
	expect(
		$('figure')
			.toArray()
			.map((node) => $(node).attr('id')),
	).toEqual(['figure-alpha', 'figure-alpha-2', 'figure-beta']);
	expect(
		$('.figure-link')
			.toArray()
			.map((node) => $(node).text()),
	).toEqual(['See fig. 1', 'See fig. 2', 'See fig. 3']);
	expect(
		$('#category_figures a')
			.toArray()
			.map((node) => $(node).attr('href')),
	).toEqual(['#figure-alpha', '#figure-alpha-2', '#figure-beta']);
	verifyReferences($);
});

it('reserves existing first-figure identifiers when another slug resembles a numbered figure', async () => {
	for (const specs of [
		[
			['alpha', 2],
			['alpha-2', 1],
		],
		[
			['alpha-2', 1],
			['alpha', 2],
		],
	]) {
		const $ = await document(specs);
		expect(
			$('#alpha figure')
				.toArray()
				.map((node) => $(node).attr('id')),
		).toEqual(['figure-alpha', 'figure-alpha-3']);
		expect($('#alpha-2 figure').attr('id')).toBe('figure-alpha-2');
		verifyReferences($);
	}
});

it('avoids collisions with entry IDs as well as other generated figures', async () => {
	const $ = await document([
		['alpha', 2],
		['figure-alpha', 0],
	]);
	verifyReferences($);
	expect($('#alpha figure').first().attr('id')).not.toBe('figure-alpha');
});

it('numbers figures with numeric addition, including double-digit references', async () => {
	const $ = await document([['alpha', 11]]);
	expect(
		$('figcaption span')
			.toArray()
			.map((node) => $(node).text()),
	).toEqual(Array.from({ length: 11 }, (_, i) => String(i + 1)));
	expect($('.figure-link').last().text()).toBe('See fig. 11');
	verifyReferences($);
});
