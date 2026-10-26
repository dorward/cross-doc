import read from '../read.js';
import { resolveProjectLayout } from '../layout.js';
import { resolve } from 'node:path';
import type { Category, ProjectOptions, ResolvedProjectLayout } from '../types.js';
import { categories } from '../metadata.js';
export { record, text, stringArray, safeKeys, aliases, frontMatter } from '../metadata.js';
export async function readCategories(
	project: string | ProjectOptions,
	context?: ResolvedProjectLayout,
): Promise<Category[]> {
	const layout =
		context ?? (await resolveProjectLayout(typeof project === 'string' ? { project } : project));
	const value: unknown = JSON.parse(await read(resolve(layout.project, layout.paths.categories)));
	return categories(value);
}
