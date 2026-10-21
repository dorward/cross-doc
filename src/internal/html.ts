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
	return $('[id]').filter((_index, element) => $(element).attr('id') === href.slice(1));
};
