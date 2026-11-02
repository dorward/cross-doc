import { basename, resolve } from 'node:path';
import type { ProjectIndex } from './types.js';
import { canonicalReference } from './project_index.js';

// Strict application selection is separate from get_files' permissive filter.
export default function selectFiles(
	files: readonly string[],
	include?: readonly string[],
	index?: ProjectIndex,
): string[] {
	if (include === undefined) return [...files];
	if (
		!Array.isArray(include) ||
		!include.length ||
		include.some((slug) => typeof slug !== 'string' || !slug.trim())
	)
		throw new TypeError('Include must contain one or more nonempty slugs');
	const identity = (file: string): string => {
		if (!index) return basename(file, '.md');
		const found = index.entries.find((entry) => entry.path === resolve(file));
		if (!found) throw new Error(`File is not in project index: ${file}`);
		return found.identity;
	};
	const known = new Set(files.map(identity));
	const requested = new Set<string>();
	const duplicates = new Set<string>();
	for (const value of include) {
		const slug = index ? canonicalReference(value, index) : value;
		if (requested.has(slug)) duplicates.add(slug);
		requested.add(slug);
	}
	const unknown = [...requested].filter((slug) => !known.has(slug));
	const errors = [];
	const label = index?.layout.identity === 'vault-path-v1' ? 'identities' : 'slugs';
	if (unknown.length) errors.push(`Unknown include ${label}: ${unknown.join(', ')}`);
	if (duplicates.size) errors.push(`Duplicate include ${label}: ${[...duplicates].join(', ')}`);
	if (errors.length) throw new Error(errors.join('; '));
	return files.filter((file) => requested.has(identity(file)));
}
