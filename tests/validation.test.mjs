import { afterEach, beforeEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as api from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

const parse = (metadata) =>
	api.parse_data([
		{
			path: 'validation.md',
			contents: `---\n${JSON.stringify({ type: 'person', title: 'Example', ...metadata })}\n---\n# Example`,
		},
	]);
const sheet = {
	name: 'Example',
	player: 'Ada',
	motivation: 'Discovery',
	origin: 'Explorer',
	heropoints: { current: 2, max: 3 },
	qualities: [{ name: 'Courage', value: 'EXP' }],
	powers: [],
};

it.each([
	[{ title: 42 }, 'title'],
	[{ type: {} }, 'type'],
	[{ alias: 'invalid' }, 'Aliases'],
	[{ alias: [null] }, 'Alias'],
	[{ alias: [{ name: 12 }] }, 'Alias name'],
	[{ alias: [{ name: 'Name', secret: 'yes' }] }, 'Alias secret'],
	[{ alias: [{ name: 'Name', index: [] }] }, 'Alias index'],
	[{ figures: {} }, 'Figures'],
	[{ figures: [{ file: 'map.svg' }] }, 'Figure caption'],
	[{ also: 42 }, 'also'],
	[{ also: [null] }, 'also'],
	[{ summary: [{}] }, 'summary'],
	[{ monoDirectionalLinks: 'bob' }, 'monoDirectionalLinks'],
	[{ monoDirectionalLinks: [''] }, 'monoDirectionalLinks'],
	[{ monoDirectionalLinks: [null] }, 'monoDirectionalLinks'],
	[{ expandedIndex: 'yes' }, 'expandedIndex'],
	[{ date: 'not-a-date' }, 'Date'],
	[{ date: false }, 'Date'],
	[{ sheet: {} }, 'Sheet name'],
	[{ sheet: { ...sheet, heropoints: { current: -1, max: 3 } } }, 'hero points'],
	[{ sheet: { ...sheet, qualities: [{ name: 'Courage', value: 'MAX' }] } }, 'quality level'],
	[{ sheet: { ...sheet, powers: [{ name: 'Magic', value: 'AVG', notes: 42 }] } }, 'notes'],
])('rejects malformed metadata %j with a useful field error', (metadata, field) => {
	expect(() => parse(metadata)).toThrow(field);
	expect(() => parse(metadata)).toThrow('Error handling validation:');
});

it.each(['', ' null', ' []'])(
	'treats empty monoDirectionalLinks YAML (%j) as an empty list',
	(value) => {
		const [entry] = api.parse_data([
			{
				path: 'ares-ptah.md',
				contents: `---\ntitle: 'Investigation: The Ares / Ptah Army'\ntype: todo\nmonoDirectionalLinks:${value}\nfigures:\n  - file: vision-mountain.png\n    caption: Image seen in the smoke\n---\n# Investigation\n`,
			},
		]);
		expect(entry.monoDirectionalLinks).toEqual([]);
		expect(entry.figures).toEqual([
			{ file: 'vision-mountain.png', caption: 'Image seen in the smoke' },
		]);
		expect(() => api.warn_missing_reciprocal_links([entry], {})).not.toThrow();
	},
);

it.each(['also', 'summary', 'alias', 'figures', 'monoDirectionalLinks'])(
	'normalizes blank, null and empty-array %s front matter',
	(field) => {
		for (const value of ['', ' null', ' []']) {
			const [entry] = api.parse_data([
				{
					path: 'empty.md',
					contents: `---\ntitle: Example\ntype: person\n${field}:${value}\n---\n# Example`,
				},
			]);
			expect(entry[field]).toEqual([]);
		}
	},
);

it.each(['qualities', 'powers'])('normalizes blank, null and empty-array sheet %s', (field) => {
	for (const value of ['', ' null', ' []']) {
		const fields = Object.entries(sheet)
			.filter(([key]) => key !== field)
			.map(([key, item]) => `  ${key}: ${JSON.stringify(item)}`)
			.join('\n');
		const [entry] = api.parse_data([
			{
				path: 'empty-sheet.md',
				contents: `---\ntitle: Example\ntype: person\nsheet:\n${fields}\n  ${field}:${value}\n---\n# Example`,
			},
		]);
		expect(entry.sheet[field]).toEqual([]);
	}
});

it('preserves supported optional fields and unknown metadata without widening known fields', () => {
	const [entry] = parse({
		alias: ['Explorer', { name: 'Ada', index: 'A', note: 'Public', secret: true }],
		figures: [{ file: 'map.svg', caption: 'Map' }],
		date: '2020-02-03',
		sheet,
		also: ['bob'],
		summary: ['An explorer'],
		monoDirectionalLinks: ['bob'],
		expandedIndex: true,
		custom: { provenance: 'campaign' },
	});
	expect(entry.custom).toEqual({ provenance: 'campaign' });
	expect(entry.alias[1].secret).toBe(true);
	expect(entry.date).toBe('2020-02-03');
	expect(entry.sheet.heropoints).toEqual({ current: 2, max: 3 });
});

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
});
afterEach(async () => {
	await fixture.cleanup();
});

it.each([
	[{}, 'Categories must be an array'],
	[[{ category: 'person' }], 'Category heading'],
	[[{ category: 'person', heading: 'People', sort: 'typo' }], 'Category sort'],
	[
		[
			{ category: 'person', heading: 'People' },
			{ category: 'person', heading: 'Again' },
		],
		'Duplicate category',
	],
	[
		[{ category: 'person', heading: 'People', extra: { constructor: 'unsafe' } }],
		'Unsafe front matter key',
	],
])(
	'validates category JSON consistently across sorting, HTML and TOC',
	async (categories, message) => {
		await writeFile(join(fixture.project, 'data/categories.json'), JSON.stringify(categories));
		await expect(api.sort({ project: fixture.project })).rejects.toThrow(message);
		await expect(
			api.generate_html([], { project: fixture.project, theme: 'default' }),
		).rejects.toThrow(message);
		const { load } = await import('cheerio');
		await expect(
			api.add_table_of_contents(load('<nav id="toc"></nav>'), { project: fixture.project }),
		).rejects.toThrow(message);
	},
);

it('rejects malformed JSON, unknown categories and missing chronological dates', async () => {
	await writeFile(join(fixture.project, 'data/categories.json'), '{broken');
	await expect(api.sort({ project: fixture.project })).rejects.toThrow(SyntaxError);
	await writeFile(
		join(fixture.project, 'data/categories.json'),
		'[{"category":"event","heading":"Events","sort":"date"}]',
	);
	const { sort } = await api.sort({ project: fixture.project });
	expect(() => sort(parse({ type: 'missing' }))).toThrow('Unknown category');
	expect(() => sort(parse({ type: 'event' }))).toThrow('Missing date');
});
