import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCategories } from './internal/validate.js';
import type { ProjectInspection } from './types.js';

function themeName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		!value.includes('\0') &&
		value !== '.' &&
		value !== '..' &&
		!/[\\/]/.test(value)
	);
}

export function validateTheme(theme: unknown, available: readonly string[]): string {
	if (!themeName(theme) || !available.includes(theme))
		throw new Error(`Unknown or unavailable theme: ${JSON.stringify(theme)}`);
	return theme;
}

export async function listThemes(project: string): Promise<string[]> {
	let children;
	try {
		children = await readdir(join(project, 'templates'), { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
		throw error;
	}
	const themes: string[] = [];
	for (const child of children) {
		// Match the established GUI contract: real immediate directories only.
		if (!child.isDirectory() || !themeName(child.name)) continue;
		try {
			if ((await stat(join(project, 'templates', child.name, 'index.scss'))).isFile())
				themes.push(child.name);
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	return themes.sort();
}

export async function inspectProject(project: string): Promise<ProjectInspection> {
	const [categories, themes] = await Promise.all([readCategories(project), listThemes(project)]);
	return { categories, themes };
}
