import type { HtmlDocument } from './types.js';
import { fragmentTarget } from './internal/html.js';

export default ($: HtmlDocument): void => {
	$('a[href]').each((_index, anchor) => {
		const target = fragmentTarget($, $(anchor).attr('href'));
		if (target.length) {
			const id = target.attr('id') ?? '';
			const label = id.startsWith('heading/')
				? target.text()
				: id.startsWith('anchor/')
					? target.closest('.entry').find('header h2').first().text()
					: target.attr('data-entry-identity') !== undefined
						? target.children('header').find('h2').first().text()
						: target.find('h2').text();
			$(anchor).attr('title', label);
		}
	});
};
