import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { frontMatter } from '../src/metadata.ts';
import * as api from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

const exported = parse(
	await readFile(new URL('./fixtures/pdq-sheet.yml', import.meta.url), 'utf8'),
);
const normalize = (sheet) => frontMatter({ type: 'person', title: 'Mordred', sheet }).sheet;
async function render(sheet) {
	const fixture = await projectFixture();
	try {
		const entries = api.parse_data([
			{
				path: 'mordred.md',
				contents: `---\n${JSON.stringify({ type: 'person', title: 'Mordred', sheet })}\n---\n# Mordred`,
			},
		]);
		return await api.generate_html(api.add_front_matter(api.clean_html(entries), {}), {
			project: fixture.project,
			theme: 'default',
		});
	} finally {
		await fixture.cleanup();
	}
}

it('retains the complete current PDQ sheet, normalizing numeric point strings', () => {
	expect(normalize(exported)).toEqual({ ...exported, bennies: { current: 3, max: 3 } });
});

it('prints current stats and inventory, with maximum bennies but no wounds or current bennies', async () => {
	const sheet = structuredClone(exported);
	sheet.bennies = { current: 987, max: '8' };
	sheet.qualities[0].wounds = 654;
	sheet.qualities[0].notes = '<script>quality note</script>';
	const $ = await render(sheet);
	const root = $('#sheet-mordred');
	expect(root.find('th.heropoints').text()).toBe('Bennies');
	expect(root.find('.heropoints .current em').text()).toBe('');
	expect(root.find('.heropoints .max em').text()).toBe('8');
	expect(root.text()).not.toContain('Maximum Bennies');
	expect(root.text()).not.toContain('Hero Points');
	expect(root.text()).not.toMatch(/987|654|Wounds/);
	expect(root.find('.notes').text()).toContain('<script>quality note</script>');
	expect(root.find('script, img')).toHaveLength(0);
	expect(root.text()).not.toContain(exported.background);
	expect(root.find('.qualities').text()).toContain('Shadow Powers');
	expect(root.find('.inventory').text()).not.toContain('Portion of Saint');
	expect(
		root
			.find('.inventory tr')
			.filter((_, row) => $(row).find('td').first().text() === 'Expand the Path potion')
			.text(),
	).toBe('Expand the Path potion02');
	expect(
		root
			.find('.inventory tr')
			.filter((_, row) => $(row).find('td').first().text() === 'Compass')
			.text(),
	).toBe('Compass∞2');
	expect(
		root
			.find('.inventory h3')
			.map((_, h) => $(h).text())
			.get(),
	).toContain('Lead lined box');
	expect(root.html()).not.toContain(exported.inventory[0].location);
});

it('handles nested and empty containers, escaped names, blank notes and extras fallback', async () => {
	const sheet = {
		...exported,
		inventory: [
			{ id: 'home', name: 'Home', count: null, value: null, capacity: 0, location: '' },
			{ id: 'box', name: '<Box>', count: null, value: null, capacity: 0, location: 'home' },
			{ name: '<Potion>', count: 0, value: 0, location: 'box' },
		],
		powers: [{ name: 'Ice', value: 'AVG', notes: '' }],
	};
	const $ = await render(sheet);
	expect(
		$('.inventory h3')
			.map((_, h) => $(h).text())
			.get(),
	).toEqual(['Home', 'Home / <Box>']);
	expect($('.inventory box, .inventory potion')).toHaveLength(0);
	expect($('.inventory').text()).toContain('<Potion>00');
	delete sheet.inventory;
	const fallback = await render(sheet);
	expect(fallback('.inventory').text()).toContain("Portion of Saint's Grace");
	sheet.inventory = [];
	const empty = await render(sheet);
	expect(empty('.inventory')).toHaveLength(0);
});

it.each([
	[
		[
			{ id: 'a', location: '' },
			{ id: 'a', location: '' },
		],
		'Duplicate inventory ID',
	],
	[[{ id: 'a', location: 'missing' }], 'Missing inventory container'],
	[[{ id: 'a', location: 'a' }], 'Inventory location cycle'],
	[
		[
			{ id: 'a', location: 'b' },
			{ id: 'b', location: 'a' },
		],
		'Inventory location cycle',
	],
])('rejects invalid inventory references', (items, error) => {
	expect(() =>
		normalize({
			...exported,
			inventory: items.map((item) => ({
				name: 'Container',
				count: null,
				value: null,
				capacity: 0,
				...item,
			})),
		}),
	).toThrow(error);
});

it.each([
	{ bennies: { current: 0, max: '3.5' } },
	{ qualities: [{ name: 'Ice', value: 'AVG', wounds: -1 }] },
	{ inventory: [{ name: 'Ice', count: -1, value: 0, location: '' }] },
	{ inventory: [{ name: 'Ice', count: 1, value: 0, location: '', isExpanded: 'yes' }] },
])('rejects malformed new fields', (fields) => {
	expect(() => normalize({ ...exported, ...fields })).toThrow();
});

it('accepts the verbatim full export as a text property and renders it identically', async () => {
	const yaml = await readFile(new URL('./fixtures/pdq-sheet.yml', import.meta.url), 'utf8');
	expect(normalize(yaml)).toEqual(normalize(exported));
	const mapped = await render(exported);
	const pasted = await render(yaml);
	expect(pasted('#sheet-mordred').html()).toBe(mapped('#sheet-mordred').html());
	const [entry] = api.parse_data([
		{
			path: 'mordred.md',
			contents: `---\ntype: person\ntitle: Mordred\nsheet: |\n${yaml
				.split('\n')
				.map((line) => `  ${line}`)
				.join('\n')}\n---\n# Mordred`,
		},
	]);
	expect(entry.sheet).toEqual(normalize(exported));
});

it.each([
	'name: Mordred\nname: Duplicate',
	'constructor: unsafe',
	'[]',
	'not a mapping',
	'name: [broken',
])('rejects unsafe or malformed sheet YAML text', (yaml) => {
	expect(() => normalize(yaml)).toThrow();
});

it('uses the legacy hero point maximum for sheets without bennies and leaves current blank', async () => {
	const sheet = structuredClone(exported);
	delete sheet.bennies;
	sheet.heropoints = { current: 432, max: 7 };
	const $ = await render(sheet);
	expect($('#sheet-mordred th.heropoints').text()).toBe('Bennies');
	expect($('#sheet-mordred .current em').text()).toBe('');
	expect($('#sheet-mordred .max em').text()).toBe('7');
	expect($('#sheet-mordred').text()).not.toContain('432');
});
