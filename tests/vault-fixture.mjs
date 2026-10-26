import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectFixture } from './helpers.mjs';

export async function vaultFixture() {
	const fixture = await projectFixture();
	const { project } = fixture;
	await mkdir(join(project, 'publishing'));
	await rename(join(project, 'data'), join(project, 'notes'));
	await rename(join(project, 'notes/categories.json'), join(project, 'publishing/categories.json'));
	await rename(join(project, 'templates/index.html'), join(project, 'publishing/layout.html'));
	await rename(join(project, 'templates'), join(project, 'publishing/themes'));
	await rename(join(project, 'resources'), join(project, 'attachments'));
	const config = JSON.parse(
		await readFile(
			new URL('../docs/obsidian-conversion/project.example.json', import.meta.url),
			'utf8',
		),
	);
	await writeFile(join(project, 'publishing/project.json'), JSON.stringify(config));
	const mappings = {
		version: 1,
		entries: ['alice', 'bob', 'arrival', 'departure'].map((legacySlug) => ({
			legacySlug,
			target: `notes/${legacySlug}`,
		})),
		figures: [{ legacyId: 'figure-alice', target: 'notes/alice', ordinal: 1 }],
	};
	await writeFile(join(project, 'publishing/legacy-links.json'), JSON.stringify(mappings));
	return { ...fixture, config, mappings };
}
