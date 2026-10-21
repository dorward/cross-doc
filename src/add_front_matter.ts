import type { Alias, Entry, Figure, HtmlDocument, LinkOptions } from './types.js';
import { escapeHtml } from './internal/html.js';
import { load } from 'cheerio';
import moment from 'moment';

type FigureId = (slug: string, index: number) => string;

export default (data: readonly Entry[], options: LinkOptions): Entry[] => {
	const occupied = new Set(data.map(({ slug }) => slug));
	// Keep first-figure links stable even when another entry's slug ends in -2.
	const firstFigures = new Set(
		data.filter(({ figures }) => figures?.length).map(({ slug }) => `figure-${slug}`),
	);
	const figureId: FigureId = (slug, index) => {
		const base = `figure-${slug}`;
		let suffix = index + 1;
		let id = index === 0 ? base : `${base}-${suffix}`;
		while (occupied.has(id) || (id !== base && firstFigures.has(id))) id = `${base}-${++suffix}`;
		occupied.add(id);
		return id;
	};
	return data.map((entry) => add_front_matter_to_html(options, entry, figureId));
};

const add_front_matter_to_html = (options: LinkOptions, data: Entry, figureId: FigureId): Entry => {
	const { include } = options;
	const { html, pc, date, figures, slug, expandedIndex, alias, title } = data;
	const $ = load(html);
	const $header = $('header');
	const $section = $('section');
	const annotations: string[] = [];
	if (include?.length && alias) {
		const names = alias
			.filter((value) => typeof value === 'string' || !value.secret)
			.map((value) => (typeof value === 'string' ? value : value.index || value.name))
			.filter(Boolean);
		$header.find('h2').attr('data-index', JSON.stringify([title, ...names]));
	}

	if (expandedIndex) $section.attr('data-toc', slug);
	if (pc) annotations.push(`<p class="PC">PC: <em>${escapeHtml(pc)}</em></p>`);
	if (date)
		annotations.push(
			`<p class="date"><time datetime="${moment(date).format('YYYY-MM-DD')}">${moment(date).format(
				'MMM YYYY',
			)}</time></p>`,
		);

	let { also } = data;
	if (also && also.length && include && include.length) {
		also = also.filter((item) => include.includes(item));
	}
	generate_also(also, $section);

	const generated_figures = generate_figures(figures, annotations, slug, figureId);
	const generated_aliases = generate_aliases(alias, options);

	if (annotations.length) $header.append(`<aside>${annotations.join('\n')}</aside>`);
	if (generated_figures.length) $section.append(generated_figures.join('\n'));
	if (generated_aliases) {
		$header.after(generated_aliases);
	}

	return { ...data, html: $('body').html() ?? '' };
};

const generate_aliases = (alias: Alias[] | undefined, options: LinkOptions): string | undefined => {
	if (!alias) return;
	const aliases: string[] = [];
	alias.forEach((alias) => {
		const { name, note, secret } =
			typeof alias === 'string' ? { name: alias, note: undefined, secret: false } : alias;
		if (options.include && options.include.length && secret) return;
		let text = name;
		if (note) {
			text = `${name} (${note})`;
		}
		aliases.push(`<li>${escapeHtml(text)}</li>`);
	});
	if (!aliases.length) return;
	return `<aside class="aliases">
	<h3>Alias${aliases.length > 2 ? 'es' : ''}</h3>
	<ul>
		${aliases.join('\n\t\t')}
	</ul>
</aside>`;
};

const generate_also = (also: string[] | undefined, $section: ReturnType<HtmlDocument>): void => {
	if (also) {
		const html = also
			.sort()
			.map((item) => `<li><a class="see-also" href="#${escapeHtml(item)}">Placeholder</a></li>`)
			.join('\n');
		$section.append('<div class="see-also">See also: <ul>' + html + '</ul></div>');
	}
};

const generate_figures = (
	figures: Figure[] | undefined,
	annotations: string[],
	slug: string,
	figureId: FigureId,
): string[] => {
	const generated_figures: string[] = [];
	if (figures) {
		figures.forEach((data, index) => {
			const id = figureId(slug, index);
			const link = `<a class="figure-link" href="#${escapeHtml(id)}">Figure Link Placeholder</a>`;
			annotations.push(link);

			const html = `
			<figure id="${escapeHtml(id)}">
				<div><img src="../resources/${escapeHtml(data.file)}"></div>
				<figcaption>fig. <span>figcount</span> ${escapeHtml(data.caption)}</figcaption>
			</figure>`;
			generated_figures.push(html);
		});
	}
	return generated_figures;
};
