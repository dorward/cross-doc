import type { Alias, Entry, HtmlDocument } from './types.js';
import { escapeHtml } from './internal/html.js';
import { load } from 'cheerio';

export default (data: readonly Entry[]): Entry[] => data.map(clean_html_file);

const clean_html_file = (data: Entry): Entry => {
	const { html, slug, title, alias } = data;
	const aliases = alias || [];
	if (!Array.isArray(aliases)) throw new TypeError(`Aliases for ${slug} must be an array`);
	const indexNames = aliases.map(get_index_names_from_aliases).filter((name) => !!name);
	indexNames.unshift(title);
	const indexes = escapeHtml(JSON.stringify(indexNames));
	const $ = load(`<section class="entry" id="${escapeHtml(slug)}">${html}</section>`);
	downgrade_headings($);
	const heading = $('h1');
	heading.replaceWith(`<header><h2 data-index="${indexes}">${heading.html()}</h2></header>`);
	return { ...data, html: $('body').html() ?? '' };
};

const downgrade_headings = ($: HtmlDocument): void => {
	$('h3').each((_index, h) => {
		$(h).replaceWith($('<h4 />').html($(h).html() ?? ''));
	});
	$('h2').each((_index, h) => {
		$(h).replaceWith($('<h3 />').html($(h).html() ?? ''));
	});
};

const get_index_names_from_aliases = (alias: Alias): string => {
	if (typeof alias === 'string') return alias;
	const { name, index } = alias;
	if (typeof index === 'string') return index;
	if (typeof name === 'string') return name;
	return name;
};
