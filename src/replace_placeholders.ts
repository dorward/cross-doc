import type { HtmlDocument } from './types.js';
import { fragmentTarget } from './internal/html.js';
export default ($: HtmlDocument): void => {
	$('.see-also a').each((_i, a) => {
		const href = $(a).attr('href');
		const target = fragmentTarget($, href);
		const heading =
			target.attr('data-entry-identity') === undefined
				? target.find('h2').text()
				: target.children('header').find('h2').first().text();
		$(a).text(heading);
	});
	$('figure').each((i, count) => {
		$(count)
			.find('span')
			.text(String(i + 1));
	});
	$('.figure-link').each((_i, a) => {
		const href = $(a).attr('href');
		const no = fragmentTarget($, href).find('figcaption span').text();
		$(a).text(`See fig. ${no}`);
	});
};
