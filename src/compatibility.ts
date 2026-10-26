import { load } from 'cheerio';
import { canonicalReference, entryId, figureId, idHref } from './project_index.js';
import type { Diagnostic, ParsedEntry, ProjectIndex } from './types.js';

// Step 2 supports recorded legacy fragments/metadata. Markdown/Wikilink path resolution follows in step 3.
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
		const $ = load(entry.html);
		$('a[href]').each((_i, element) => {
			const href = $(element).attr('href');
			if (!href?.startsWith('#')) return;
			const token = href.slice(1);
			const figure = index.legacyLinks.figures.find((item) => item.legacyId === token);
			if (figure) $(element).attr('href', idHref(figureId(figure.target, figure.ordinal)));
			else {
				const target = reference(token);
				if (index.entries.some((item) => item.identity === target))
					$(element).attr('href', idHref(entryId(target)));
			}
		});
		return {
			...entry,
			html: $('body').html() ?? '',
			...(entry.also ? { also: entry.also.map(reference) } : {}),
			...(entry.monoDirectionalLinks
				? { monoDirectionalLinks: entry.monoDirectionalLinks.map(reference) }
				: {}),
		};
	});
}
