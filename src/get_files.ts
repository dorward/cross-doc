import type { Options } from './types.js';
import { basename } from 'node:path';
import { resolveProjectLayout } from './layout.js';
import { canonicalReference, discoverFiles, indexWithLayout } from './project_index.js';

export default async (options: Options): Promise<string[]> => {
	const { include } = options;
	if (
		include !== undefined &&
		(!Array.isArray(include) || include.some((value) => typeof value !== 'string'))
	)
		throw new TypeError('Include must be an array of slugs');
	const layout = await resolveProjectLayout(options);
	const paths = await discoverFiles(layout);
	if (include === undefined) return paths;
	if (layout.identity === 'legacy')
		return paths.filter((file) => include.includes(basename(file, '.md')));
	const index = await indexWithLayout(layout, paths);
	const selected = new Set(include.map((value) => canonicalReference(value, index)));
	return index.entries.filter((entry) => selected.has(entry.identity)).map((entry) => entry.path);
};
