import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as api from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
	await writeFile(
		join(fixture.project, 'data/categories.json'),
		JSON.stringify([
			{ category: 'event-a', heading: 'Events A', sort: 'date' },
			{ category: 'artefact', heading: 'Artefacts' },
			{ category: 'event-c', heading: 'Events C', sort: 'date' },
		]),
	);
});
afterEach(async () => {
	await fixture.cleanup();
});

function entry(slug, type, date, title = slug) {
	const metadata = { type, title, ...(date ? { date } : {}) };
	return api.add_front_matter(
		api.clean_html(
			api.parse_data([
				{
					path: `${slug}.md`,
					contents: `---\n${JSON.stringify(metadata)}\n---\n# ${title}\n`,
				},
			]),
		),
		{},
	)[0];
}
function mixedEntries() {
	return [
		entry('a-late', 'event-a', '2023-03-11'),
		entry('artefact', 'artefact'),
		entry('c-early', 'event-c', '2000-05-01'),
		entry('a-early', 'event-a', '2018-05-12'),
		entry('a-middle', 'event-a', '2022-09-22'),
		entry('c-late', 'event-c', '2022-09-30'),
	];
}
function* permutations(items) {
	if (!items.length) {
		yield [];
		return;
	}
	for (let index = 0; index < items.length; index++) {
		for (const rest of permutations(items.filter((_, position) => position !== index))) {
			yield [items[index], ...rest];
		}
	}
}

it('keeps category precedence and chronology for every mixed-category input permutation', async () => {
	const { sort } = await api.sort({ project: fixture.project });
	for (const input of permutations(mixedEntries())) {
		expect(sort(input).map(({ slug }) => slug)).toEqual([
			'a-early',
			'a-middle',
			'a-late',
			'artefact',
			'c-early',
			'c-late',
		]);
	}
});

it('preserves chronological order inside each generated HTML category', async () => {
	const { sort } = await api.sort({ project: fixture.project });
	const $ = await api.generate_html(sort(mixedEntries()), {
		project: fixture.project,
		theme: 'default',
	});
	expect(
		$('.category')
			.toArray()
			.map((node) => $(node).attr('id')),
	).toEqual(['event-a', 'artefact', 'event-c']);
	expect(
		$('#event-a .entry')
			.toArray()
			.map((node) => $(node).attr('id')),
	).toEqual(['a-early', 'a-middle', 'a-late']);
	expect(
		$('#event-c .entry')
			.toArray()
			.map((node) => $(node).attr('id')),
	).toEqual(['c-early', 'c-late']);
});

it('uses titles for equal dates and title categories, retaining input order for equal keys', async () => {
	const { sort } = await api.sort({ project: fixture.project });
	const input = [
		entry('z-date', 'event-a', '2020-01-01', 'Zulu'),
		entry('twin-second', 'event-a', '2020-01-01', 'Same'),
		entry('z-title', 'artefact', '1990-01-01', 'Zulu'),
		entry('a-title', 'artefact', '2030-01-01', 'Alpha'),
		entry('twin-first', 'event-a', '2020-01-01', 'Same'),
		entry('a-date', 'event-a', '2020-01-01', 'Alpha'),
	];
	expect(sort(input)).toBe(input);
	expect(input.map(({ slug }) => slug)).toEqual([
		'a-date',
		'twin-second',
		'twin-first',
		'z-date',
		'a-title',
		'z-title',
	]);
});
