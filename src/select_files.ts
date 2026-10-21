import { basename } from 'node:path';

// Strict application selection is separate from get_files' permissive filter.
export default function selectFiles(
	files: readonly string[],
	include?: readonly string[],
): string[] {
	if (include === undefined) return [...files];
	if (
		!Array.isArray(include) ||
		!include.length ||
		include.some((slug) => typeof slug !== 'string' || !slug.trim())
	)
		throw new TypeError('Include must contain one or more nonempty slugs');
	const known = new Set(files.map((file) => basename(file, '.md')));
	const requested = new Set<string>();
	const duplicates = new Set<string>();
	for (const slug of include) {
		if (requested.has(slug)) duplicates.add(slug);
		requested.add(slug);
	}
	const unknown = [...requested].filter((slug) => !known.has(slug));
	const errors = [];
	if (unknown.length) errors.push(`Unknown include slugs: ${unknown.join(', ')}`);
	if (duplicates.size) errors.push(`Duplicate include slugs: ${[...duplicates].join(', ')}`);
	if (errors.length) throw new Error(errors.join('; '));
	return files.filter((file) => requested.has(basename(file, '.md')));
}
