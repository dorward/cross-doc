import type {
	Category,
	CharacterSheet,
	Entry,
	GenerateHtmlOptions,
	HtmlDocument,
	Power,
	Quality,
} from './types.js';
import { listThemes, validateTheme } from './inspection.js';
import { readCategories } from './internal/validate.js';
type CategoryGroup = Category & { items: Entry[] };
import { escapeHtml } from './internal/html.js';
import { load } from 'cheerio';
import { compileAsync } from 'sass';
import write from './internal/write.js';
import read from './read.js';
import moment from 'moment';

export default async (
	data: readonly Entry[],
	options: GenerateHtmlOptions,
): Promise<HtmlDocument> => {
	const categories = await readCategories(options.project);
	validateTheme(options.theme, await listThemes(options.project));
	return generateHtmlWithCategories(data, options, categories);
};

export async function generateHtmlWithCategories(
	data: readonly Entry[],
	{ project, theme }: GenerateHtmlOptions,
	categories: readonly Category[],
): Promise<HtmlDocument> {
	const template = await read(`${project}/templates/index.html`);

	const { css } = await compileAsync(`${project}/templates/${theme}/index.scss`);
	await write(`${project}/templates/index.css`, css);

	// Generate skeleton
	const $ = load(template);

	// Group data
	const types: CategoryGroup[] = categories.map((type) => ({ ...type, items: [] }));
	data.forEach((item) => {
		const category = types.find((type) => type.category === item.type);
		if (!category)
			throw new Error(`Could not find a type entry for category ${item.type} for ${item.title}`);
		category.items.push(item);
	});

	// Add data
	types.forEach((type) => {
		if (type.items.length === 0) {
			return;
		}
		const entries = type.items.map((item) => item.html).join('\n');
		const category_section = `
            <section class="category" id="${escapeHtml(type.category)}">
                <h1>${escapeHtml(type.heading)}</h1>
                ${entries}
            </section>
		`;
		$('main').append(category_section);

		// Sheets
		const cs = type.items
			.filter((i) => i.sheet)
			.map((entry) =>
				entry.sheet ? generate_character_sheets({ slug: entry.slug, sheet: entry.sheet }) : '',
			)
			.join('\n');
		if (cs) {
			$('aside#character-sheets').append(cs);
		}
	});

	const timeline = generate_timeline(types, $);
	if (timeline) {
		$('aside#timeline').append(...timeline);
	}

	// Generate string
	return $;
}

const generate_timeline = (types: CategoryGroup[], $: HtmlDocument) => {
	const results: ReturnType<HtmlDocument>[] = [];
	types
		.map((type) => {
			const items_with_dates = type.items
				.filter((item) => item.date)
				.map((item) => ({
					date: moment(item.date),
					title: item.title,
					slug: item.slug,
					summary: item.summary || [],
				}));
			return items_with_dates;
		})
		.reduce((acc, cur) => acc.concat(cur), [])
		.sort((a, b) => a.date.valueOf() - b.date.valueOf())
		.forEach((item) => {
			const $date = $('<h2 />').text(item.date.format('Do MMMM YYYY'));
			const $h = $('<h3 />').append(
				$('<a />').addClass('timeline-link').text(item.title).attr('href', `#${item.slug}`),
			);
			const $list = item.summary.map((text) => $('<p />').text(text));
			results.push($date, $h, ...$list);
		});

	return results;
};

const generate_character_sheets = ({
	slug,
	sheet,
}: {
	slug: string;
	sheet: CharacterSheet;
}): string => {
	const { name, player, motivation, origin, heropoints, qualities, powers } = sheet;

	return `
		<section class="character-sheet" id="sheet-${escapeHtml(slug)}">
			<h1>${escapeHtml(name)}</h1>
			<table class="meta">
				<tr>
					<th class="player">Player</th>
					<td class="player">${escapeHtml(player)}</td>
					<th class="heropoints">Hero Points</th>
				</tr>
				<tr>
					<th class="motivation">Motivation</th>
					<td class="motivation">${escapeHtml(motivation)}</td>
					<td class="heropoints" rowspan="3">
					<span class="current"><em>${escapeHtml(heropoints.current)}</em><br>Current</span>\t
					<span class="max"><em>${escapeHtml(heropoints.max)}</em><br>Max</span>
						
					</td>
				</tr>
				<tr>
					<th class="origin">Origin</th>
					<td class="origin">${escapeHtml(origin)}</td>
				</tr>
			</table>

			<table class="qualities">
				<tbody>
					<tr>
						<th>Standard Qualities</th>
						<th>MSTR<br>+6</th>
						<th>EXP<br>+4</th>
						<th>GD<br>+2</th>
						<th>AVG<br>+0</th>
						<th>PR<br>-2</th>
						<th>GO<br>NE</th>
					</tr>
					${makeRows(qualities)}
				</tbody>
				<tbody>
					<tr>
						<th>Powers</th>
						<th>MSTR<br>+6</th>
						<th>EXP<br>+4</th>
						<th>GD<br>+2</th>
						<th>AVG<br>+0</th>
						<th>PR<br>-2</th>
						<th>GO<br>NE</th>
					</tr>
					${makeRows(powers)}
				</tbody>
			</table>

			<section class="notes">
				${makeNotes(powers)}
			</section>
		</section>
	`;
};

const makeNotes = (powers: readonly Power[]): string => {
	const filtered = powers.filter((power) => power.notes);
	const md = filtered.map(
		(power) => `\n<h2>${escapeHtml(power.name)}</h2>\n\n<p>${escapeHtml(power.notes)}</p>`,
	);
	return md.join('\n\n');
};

const makeRows = (qualities: readonly Quality[]): string => qualities.map(makeRow).join('\n');

const levels = [
	{ name: 'MSTR', value: '+6' },
	{ name: 'EXP', value: '+4' },
	{ name: 'GD', value: '+2' },
	{ name: 'AVG', value: '+0' },
	{ name: 'PR', value: '-2' },
];

const makeRow = (quality: Quality): string => {
	const index = levels.findIndex((entry) => entry.name === quality.value);

	const html = `<tr>
		<td>${escapeHtml(quality.name)}</td>
	${levels
		.map(
			(level, dex) => `<td class="${dex < index ? 'unobtained' : 'obtained'}">${level.value}</td>`,
		)
		.join('\n')}<td></td></tr>\n`;
	return html;
};
