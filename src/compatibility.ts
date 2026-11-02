import { canonicalReference } from './project_index.js';
import type { Diagnostic, ParsedEntry, ProjectIndex } from './types.js';

// Keep source frontmatter intact; normalize only the in-memory relationship values.
export function normalizeCompatibility(
	entries: readonly ParsedEntry[],
	index: ProjectIndex,
	diagnostics: Diagnostic[],
): ParsedEntry[] {
	const warned = new Set<string>();
	return entries.map((entry) => {
		const reference = (value: string): string => {
			const target = canonicalReference(value, index);
			const key = JSON.stringify([entry.slug, value]);
			if (target !== value && !warned.has(key)) {
				warned.add(key);
				diagnostics.push({
					code: 'legacy-reference',
					severity: 'warning',
					source: entry.slug,
					target: value,
				});
			}
			return target;
		};
		return {
			...entry,
			...(entry.also ? { also: entry.also.map(reference) } : {}),
			...(entry.monoDirectionalLinks
				? { monoDirectionalLinks: entry.monoDirectionalLinks.map(reference) }
				: {}),
		};
	});
}
