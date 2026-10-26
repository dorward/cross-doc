import type { HtmlDocument } from '../types.js';
export const escapeHtml = (value: unknown): string =>
	String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			})[character] ?? character,
	);

export const fragmentTarget = (
	$: HtmlDocument,
	href: string | undefined,
): ReturnType<HtmlDocument> => {
	if (typeof href !== 'string' || !href.startsWith('#')) return $([]);
	const fragment = href.slice(1);
	// New namespaced IDs use URI escaping; legacy fragments retain exact historic matching.
	let id = fragment;
	if (/^(?:entry|figure|sheet|category|heading|anchor)\//.test(fragment)) {
		try {
			id = decodeURIComponent(fragment);
		} catch {
			return $([]);
		}
	}
	return $('[id]').filter((_index, element) => $(element).attr('id') === id);
};
