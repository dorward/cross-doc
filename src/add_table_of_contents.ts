'use strict';

import { readCategories, stringArray } from './internal/validate.js';
import { escapeHtml } from './internal/html.js';
import type { Category, HtmlDocument, ProjectOptions } from './types.js';

const basic_sort = (a: { text: string }, b: { text: string }): number => {
	var A = a.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
	var B = b.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (A < B) return -1;
	if (A > B) return 1;
	return 0;
};

const expression = /^.*?">/;
const sort_by_label = (a_html: string, b_html: string): number => {
	const a = a_html.toUpperCase().replace(expression, '');
	const b = b_html.toUpperCase().replace(expression, '');
	if (a === b) {
		return 0;
	} else if (a < b) {
		return -1;
	} else {
		return 1;
	}
};

const extract_date = /\d\d\d\d-\d\d-\d\d/;
const date_sort = (A: string, B: string): number => {
	const a = A.match(extract_date)?.[0];
	const b = B.match(extract_date)?.[0];
	if (!a || !b) throw new Error('Missing date in chronological table of contents');
	if (a === b) {
		return sort_by_label(A, B);
	} else if (a < b) {
		return -1;
	} else {
		return 1;
	}
};

export default async ($: HtmlDocument, options: ProjectOptions): Promise<void> => {
	addTableOfContentsWithCategories($, await readCategories(options.project));
};

export function addTableOfContentsWithCategories(
	$: HtmlDocument,
	detailed_types: readonly Category[],
): void {
	const categories: string[] = [];

	$('.category').each((_i, category) => {
		const category_element = $(category);
		const h1 = category_element.find('h1');
		const category_label = h1.text();
		const category_id = category_element.attr('id');
		const category_link = `#${category_id}`;
		const type = detailed_types.find((type) => type.category === category_id);
		if (!type) throw new Error(`Unknown category in table of contents: ${category_id}`);
		const sort_method = type.sort === 'date' ? date_sort : sort_by_label;
		const entries: string[] = [];
		$(category)
			.find('.entry')
			.each((_i, entry) => {
				const entry_element = $(entry);
				let time: string | undefined;
				const time_element = entry_element.find('time');
				if (time_element.attr('datetime')) {
					time = time_element.attr('datetime');
				}
				const h2 = entry_element.find('h2');
				const entry_labels: unknown = h2.data('index'); // jQuery compatible so this parses the JSON for me
				const entry_link = `#${entry_element.attr('id')}`;
				if (!entry_labels) {
					throw new Error(`Heading missing from the markup of ${escapeHtml(entry_link)}`);
				}
				stringArray(entry_labels, `Index labels for ${escapeHtml(entry_link)}`);
				const expandedIndex = entry_element.attr('data-toc');
				let expandedIndexHTML = '';
				if (expandedIndex) {
					const items: { link: string; text: string }[] = [];

					entry_element.find('li a:not(.see-also)').each((_index, element) => {
						const e = $(element);
						if (e.is('.entry > header a')) {
							return;
						}
						items.push({ link: e.attr('href') ?? '', text: e.text() });
					});

					items.sort(basic_sort);

					const html: string[] = [];
					items.forEach(({ link, text }) =>
						html.push(`<li><a class="toc" href="${escapeHtml(link)}">${escapeHtml(text)}</a></li>`),
					);
					expandedIndexHTML = `<ul>${html.join('')}</ul>`;
				}
				entry_labels.forEach((entry_label, index) => {
					const data_time = time && ` data-time="${escapeHtml(time)}"`;
					const html = `<li><a class="toc" ${data_time || ''} href="${escapeHtml(entry_link)}">${escapeHtml(entry_label)}</a>${
						!index ? expandedIndexHTML : ''
					}</li>`;
					entries.push(html);
				});
			});

		const html = `
                <li id="category_${escapeHtml(category_element.attr('id'))}">
                    <a class="toc" href="${escapeHtml(category_link)}">${escapeHtml(category_label)}</a>
                    <ol>
                        ${entries.sort(sort_method).join('\n')}
                    </ol>
                </li>
            `;
		categories.push(html);
	});

	{
		// Figure "category"
		const entries: string[] = [];
		$('figure').each((_i, figure) => {
			const $fig = $(figure);
			const entry_link = `#${$fig.attr('id')}`;
			const entry_label = `${$fig.text().trim()}`;
			const html = `<li><a class="toc" href="${escapeHtml(entry_link)}">${escapeHtml(entry_label)}</a></li>`;
			entries.push(html);
		});

		if (entries.length) {
			const html = `
                <li id="category_figures">
                    <span>Figures</span>
                    <ol>
                        ${entries.join('\n')}
                    </ol>
                </li>
            `;
			categories.push(html);
		}
	}

	const html = `<ol>${categories.join('\n')}</ol>`;

	$('#toc').append(html);
	let previous = '';
	$('#toc > ol > li:not(#category_event) > ol > li').each((_index, element) => {
		const $e = $(element);
		const firstLetter = $e.text().charAt(0);
		if (firstLetter !== previous) {
			previous = firstLetter;
			$e.addClass('first_of_letter');
		}
	});
	// console.log('Done!!');
}
