// These tests verify the step-1 specification/capture, not future compiler behavior.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import parseData from '../src/parse_data.ts';

const root = new URL('../docs/obsidian-conversion/', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const encoded = (text) => text.split('/').map(encodeURIComponent).join('/');

describe('Obsidian v1 specification fixtures', () => {
	it('provides reversible, collision-free DOM IDs and fragment hrefs', async () => {
		const { valid } = await readJson('identity-vectors.json');
		for (const vector of valid) {
			expect(vector.path.slice(0, -3)).toBe(vector.identity);
			expect(`entry/${encoded(vector.identity)}`).toBe(vector.id);
			expect(`#${encoded(vector.id)}`).toBe(vector.href);
			expect(decodeURIComponent(vector.href.slice(1))).toBe(vector.id);
			expect(vector.id.slice(6).split('/').map(decodeURIComponent).join('/')).toBe(vector.identity);
		}
		expect(new Set(valid.map((item) => item.id)).size).toBe(valid.length);
	});

	it('defines strict schemas with safe path patterns and portability collision cases', async () => {
		const schema = await readJson('project.schema.json');
		const example = await readJson('project.example.json');
		const vectors = await readJson('identity-vectors.json');
		const pattern = new RegExp(schema.$defs.path.pattern);
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties.paths.additionalProperties).toBe(false);
		expect(Object.keys(example).sort()).toEqual([...schema.required].sort());
		expect(Object.keys(example.paths).sort()).toEqual([...schema.properties.paths.required].sort());
		for (const path of Object.values(example.paths)) expect(pattern.test(path)).toBe(true);
		for (const path of vectors.invalidPaths.filter(
			(path) => path !== 'notes/a.MD' && path !== 'attachments/a.md',
		))
			expect(pattern.test(path)).toBe(false);
		for (const pair of vectors.portabilityConflicts) {
			expect(pair[0]).not.toBe(pair[1]);
			expect(pair[0].normalize('NFC').toLowerCase()).toBe(pair[1].normalize('NFC').toLowerCase());
		}
	});

	it('captures a complete consistent identity/move/figure map', async () => {
		const inventory = await readJson('baseline/inventory.json');
		const mappings = await readJson('baseline/legacy-links.example.json');
		const moves = await readJson('baseline/move-map.json');
		const schema = await readJson('legacy-links.schema.json');
		const pattern = new RegExp(schema.$defs.identity.pattern);
		const identities = new Set(inventory.notes.map((note) => note.identity));
		expect(identities.size).toBe(464);
		expect(mappings.entries).toHaveLength(464);
		expect(new Set(mappings.entries.map((item) => item.legacySlug)).size).toBe(464);
		for (const mapping of mappings.entries) {
			expect(identities.has(mapping.target)).toBe(true);
			expect(pattern.test(mapping.target)).toBe(true);
		}
		expect(mappings.figures).toHaveLength(inventory.summary.figures);
		expect(new Set(mappings.figures.map((item) => item.legacyId)).size).toBe(
			mappings.figures.length,
		);
		for (const figure of mappings.figures) {
			const note = inventory.notes.find((item) => item.identity === figure.target);
			expect(figure.ordinal).toBeGreaterThan(0);
			expect(figure.ordinal).toBeLessThanOrEqual(note.metadata.figures.length);
		}
		for (const note of inventory.notes) {
			expect(sha(note.rawFrontmatter)).toBe(note.frontmatterSha256);
			expect(moves.find((move) => move.source === note.path)?.target).toBe(note.targetPath);
		}
		expect(moves.some((move) => move.source.endsWith('/.DS_Store') && move.target)).toBe(false);
	});

	it('captures all full-project entries, figures, known warnings and both representative renders', async () => {
		const inventory = await readJson('baseline/inventory.json');
		const diagnostics = await readJson('baseline/diagnostics.json');
		const capture = await readJson('baseline/capture.json');
		const $ = load(await readFile(new URL('baseline/full-A5.html', root), 'utf8'));
		expect($('section.entry')).toHaveLength(inventory.summary.notes);
		expect($('figure')).toHaveLength(inventory.summary.figures);
		expect(diagnostics).toHaveLength(35);
		expect(diagnostics.every((item) => item.code === 'missing-reciprocal-link')).toBe(true);
		expect(capture.renderFacts.map((item) => [item.theme, item.pages])).toEqual([
			['A5', 21],
			['reduced', 17],
		]);
		for (const fact of capture.renderFacts) {
			const bytes = await readFile(
				new URL(`baseline/output/pdf/${fact.theme}/representative.pdf`, root),
			);
			expect(sha(bytes)).toBe(fact.pdfSha256);
		}
	});

	it('covers each existing metadata shape and synthetic shapes absent from this campaign', async () => {
		const inventory = await readJson('baseline/inventory.json');
		const expected = [
			'title',
			'type',
			'date',
			'also',
			'monoDirectionalLinks',
			'alias',
			'figures',
			'summary',
			'expandedIndex',
			'pc',
			'sheet',
		];
		for (const key of expected) expect(inventory.metadataShapes[key]).toBeDefined();
		expect(inventory.metadataShapes['alias[]'].string.count).toBeGreaterThan(0);
		expect(inventory.metadataShapes['alias[]'].object.count).toBeGreaterThan(0);
		expect(inventory.metadataShapes.figures.null.count).toBe(32);
		const fixture = new URL('./fixtures/obsidian-contract/edge-cases.md', import.meta.url);
		const raw = await readFile(fixture, 'utf8');
		const [entry] = parseData([{ path: fileURLToPath(fixture), contents: raw }]);
		expect(entry.figures).toHaveLength(2);
		expect(entry.figures[1].caption).toBe('Second figure\nwith a second caption line.\n');
		expect(entry.date).toBe('2023-03-13');
		expect(entry.custom).toEqual({ retained: ['one', 'two'] });
		const cases = JSON.parse(
			await readFile(new URL('./fixtures/obsidian-contract/cases.json', import.meta.url), 'utf8'),
		);
		for (const item of cases.metadataCases) {
			const contents = `---\n${JSON.stringify(item.header)}\n---\n# ${item.header.title}`;
			expect(parseData([{ path: `${item.label}.md`, contents }])[0].title).toBe(item.header.title);
		}
		// The raw fixture is authoritative for future source-preservation assertions.
		expect(parse(raw.split('---')[1]).title).toBe('Contract edge cases');
	});
});
