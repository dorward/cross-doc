import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	inspectProject,
	listThemes,
	loadProject,
	readCategories,
	validateTheme,
} from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

let fixture;
beforeEach(async () => {
	fixture = await projectFixture();
});
afterEach(async () => {
	await fixture.cleanup();
});

it('returns validated categories with sort/extension fields and shares them in loaded results', async () => {
	const categories = [
		{ category: 'person', heading: 'People', sort: 'title', custom: 'retained' },
		{ category: 'event', heading: 'Events', sort: 'date' },
	];
	await writeFile(join(fixture.project, 'data/categories.json'), JSON.stringify(categories));
	expect(await readCategories(fixture.project)).toEqual(categories);
	const inspection = await inspectProject(fixture.project);
	expect(inspection).toEqual({ categories, themes: ['default'] });
	const loaded = await loadProject({ project: fixture.project });
	expect(loaded.categories).toEqual(categories);
	expect(loaded.themes).toEqual(inspection.themes);
});

it('discovers the Legends Walk theme-name set in deterministic order from a synthetic layout', async () => {
	const templates = join(fixture.project, 'templates');
	await rm(templates, { recursive: true });
	for (const name of ['reduced', 'personal', 'card', 'book', 'A5']) {
		await mkdir(join(templates, name), { recursive: true });
		await writeFile(join(templates, name, 'index.scss'), 'body {}');
	}
	await mkdir(join(templates, 'not-a-theme'));
	await writeFile(join(templates, 'index.html'), '<main></main>');
	expect(await listThemes(fixture.project)).toEqual(['A5', 'book', 'card', 'personal', 'reduced']);
});

it('ignores symlinked theme directories but accepts regular-file index.scss symlinks', async () => {
	const templates = join(fixture.project, 'templates');
	await symlink(join(templates, 'default'), join(templates, 'linked-directory'));
	await mkdir(join(templates, 'linked-entry'));
	await symlink(join(templates, 'default/index.scss'), join(templates, 'linked-entry/index.scss'));
	await mkdir(join(templates, 'directory-entry/index.scss'), { recursive: true });
	expect(await listThemes(fixture.project)).toEqual(['default', 'linked-entry']);
});

it('loads a project with no themes without writing output', async () => {
	await rm(join(fixture.project, 'templates'), { recursive: true });
	expect(await listThemes(fixture.project)).toEqual([]);
	const loaded = await loadProject({ project: fixture.project });
	expect(loaded.themes).toEqual([]);
	expect(loaded.entries).toHaveLength(4);
	await expect(readFile(join(fixture.project, 'out/document.html'))).rejects.toMatchObject({
		code: 'ENOENT',
	});
});

it.each([
	{ contents: '{broken' },
	{ contents: '[{"category":"person","heading":"One"},{"category":"person","heading":"Two"}]' },
	{ contents: '[{"category":"person","heading":"People","sort":"invalid"}]' },
])('rejects malformed categories during public inspection: %j', async ({ contents }) => {
	await writeFile(join(fixture.project, 'data/categories.json'), contents);
	await expect(inspectProject(fixture.project)).rejects.toThrow();
});

it.each(
	[
		'',
		'.',
		'..',
		'../default',
		'nested/default',
		'nested\\default',
		'bad\0name',
		'unknown',
		null,
		123,
	].map((theme) => ({ theme })),
)('rejects invalid or unavailable theme names: %j', ({ theme }) => {
	expect(() => validateTheme(theme, ['default', '../default'])).toThrow('unavailable theme');
});
it('validates an available theme without choosing a fallback', () => {
	expect(validateTheme('default', ['default'])).toBe('default');
	expect(() => validateTheme('A5', ['default'])).toThrow('A5');
});
