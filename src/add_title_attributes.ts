import type { HtmlDocument } from './types.js';
import { fragmentTarget } from './internal/html.js';

export default ($: HtmlDocument): void => {
	$('a[href]').each((_index, anchor) => {
		const target = fragmentTarget($, $(anchor).attr('href'));
		if (target.length) $(anchor).attr('title', target.find('h2').text());
	});
};
