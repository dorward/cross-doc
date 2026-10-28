import type {
	Category,
	CharacterSheet,
	InventoryItem,
	Entry,
	GenerateHtmlOptions,
	HtmlDocument,
	Power,
	Quality,
	ResolvedProjectLayout,
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
import { resolveProjectLayout } from './layout.js';
import { resolve, relative, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { resolveAsset } from './assets.js';
import { embedCssAssets } from './css_assets.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { entryId, encodeIdentity, idHref } from './project_index.js';

export default async (
	data: readonly Entry[],
	options: GenerateHtmlOptions,
): Promise<HtmlDocument> => {
	const layout = await resolveProjectLayout(options);
	const categories = await readCategories(options, layout);
	validateTheme(options.theme, await listThemes(options, layout));
	return generateHtmlWithCategories(data, options, categories, layout);
};

export async function generateHtmlWithCategories(
	data: readonly Entry[],
	options: GenerateHtmlOptions,
	categories: readonly Category[],
	context?: ResolvedProjectLayout,
): Promise<HtmlDocument> {
	const { project, theme } = options;
	const layout = context ?? (await resolveProjectLayout(options));
	const vault = layout.identity === 'vault-path-v1';
	const sourceAssets = vault || options.portableAssets === true;
	const template = await read(resolve(project, layout.paths.layout));

	const themeSource = resolve(project, layout.paths.themes, theme, 'index.scss');
	const compiled = await compileAsync(themeSource, { sourceMap: sourceAssets });
	if (sourceAssets) {
		const root = await realpath(project);
		for (const url of compiled.loadedUrls) {
			if (url.protocol !== 'file:') throw new Error(`Unsupported stylesheet source: ${url.href}`);
			const reference = relative(root, fileURLToPath(url))
				.split(sep)
				.map(encodeURIComponent)
				.join('/');
			await resolveAsset(reference, resolve(project, '_'), project);
		}
	}
	const css = sourceAssets
		? await embedCssAssets(compiled.css, themeSource, project, compiled.sourceMap)
		: compiled.css;
	const cssPath =
		(options.css_file_name ? resolve(options.css_file_name) : undefined) ??
		(vault ? resolve(project, 'out/cross-doc.css') : resolve(project, 'templates/index.css'));
	await write(cssPath, css);

	// Generate skeleton
	const $ = load(template);
	if (sourceAssets && $('[srcset]').length) throw new Error('Layout srcset assets are unsupported');
	if (
		sourceAssets ||
		(options.css_file_name !== undefined &&
			resolve(options.css_file_name) !== resolve(project, 'templates/index.css'))
	) {
		const link = $('link[data-cross-doc-theme]').length
			? $('link[data-cross-doc-theme]')
			: $('link[rel=stylesheet]').first();
		if (!link.length && sourceAssets)
			throw new Error('Vault layout requires a stylesheet link for the compiled theme');
		link.attr('href', pathToFileURL(cssPath).href);
	}

	if (sourceAssets) {
		for (const element of $('style, [style]').toArray()) {
			const node = $(element);
			const value = node.is('style') ? node.text() : (node.attr('style') ?? '');
			const css = await embedCssAssets(value, resolve(project, layout.paths.layout), project);
			if (node.is('style')) node.text(css);
			else node.attr('style', css);
		}
		for (const element of $('img[src], link[href], a[href]').toArray()) {
			const node = $(element);
			const attribute = node.is('img') ? 'src' : 'href';
			const reference = node.attr(attribute) ?? '';
			if (reference === pathToFileURL(cssPath).href) continue;
			const asset = await resolveAsset(reference, resolve(project, layout.paths.layout), project);
			if (!asset) continue;
			if (node.is('link[rel=stylesheet]')) {
				const cssSource = await read(asset.path);
				const embedded = await embedCssAssets(cssSource, asset.path, project);
				node.attr(attribute, `data:text/css;base64,${Buffer.from(embedded).toString('base64')}`);
			} else node.attr(attribute, asset.href);
		}
	}
	const renderedData: Entry[] = [];
	for (const entry of data) {
		const body = load(entry.html);
		if (sourceAssets && body('[srcset]').not('pre *,code *').length)
			throw new Error(`Image srcset assets are unsupported: ${entry.path}`);
		if (sourceAssets) {
			for (const element of body('style, [style]').not('pre *,code *,svg *,math *').toArray()) {
				const node = body(element);
				const value = node.is('style') ? node.text() : (node.attr('style') ?? '');
				const css = await embedCssAssets(value, resolve(entry.path), project);
				if (node.is('style')) node.text(css);
				else node.attr('style', css);
			}
		}
		const metadataCount = entry.figures?.length ?? 0;
		const metadataImages = new Set(
			metadataCount ? body('figure').slice(-metadataCount).find('img').toArray() : [],
		);
		for (const element of body('img[src]').toArray()) {
			const node = body(element);
			if (node.closest('pre,code,svg,math').length) continue;
			const metadata = metadataImages.has(element);
			if (!sourceAssets && (metadata || !node.closest('figure').length || !node.attr('title')))
				continue;
			const source = metadata
				? resolve(project, options.portableAssets && !vault ? 'out/_' : '_')
				: resolve(entry.path);
			const asset = await resolveAsset(node.attr('src') ?? '', source, project);
			if (asset) node.attr('src', sourceAssets ? asset.href : `../${asset.href}`);
		}
		renderedData.push({ ...entry, html: body('body').html() ?? '' });
	}

	// Group data
	const types: CategoryGroup[] = categories.map((type) => ({ ...type, items: [] }));
	renderedData.forEach((item) => {
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
            <section class="category" id="${escapeHtml(vault ? `category/${encodeIdentity(type.category)}` : type.category)}"${vault ? ` data-category="${escapeHtml(type.category)}"` : ''}>
                <h1>${escapeHtml(type.heading)}</h1>
                ${entries}
            </section>
		`;
		$('main').append(category_section);

		// Sheets
		const cs = type.items
			.filter((i) => i.sheet)
			.map((entry) =>
				entry.sheet
					? generate_character_sheets({ slug: entry.slug, sheet: entry.sheet, vault })
					: '',
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
					vault: item.vaultPath !== undefined,
					summary: item.summary || [],
				}));
			return items_with_dates;
		})
		.reduce((acc, cur) => acc.concat(cur), [])
		.sort((a, b) => a.date.valueOf() - b.date.valueOf())
		.forEach((item) => {
			const $date = $('<h2 />').text(item.date.format('Do MMMM YYYY'));
			const $h = $('<h3 />').append(
				$('<a />')
					.addClass('timeline-link')
					.text(item.title)
					.attr('href', item.vault ? idHref(entryId(item.slug)) : `#${item.slug}`),
			);
			const $list = item.summary.map((text) => $('<p />').text(text));
			results.push($date, $h, ...$list);
		});

	return results;
};

const generate_character_sheets = ({
	slug,
	sheet,
	vault,
}: {
	slug: string;
	sheet: CharacterSheet;
	vault: boolean;
}): string => {
	const { name, player, motivation, origin, heropoints, qualities, powers } = sheet;

	return `
		<section class="character-sheet" id="${escapeHtml(vault ? `sheet/${encodeIdentity(slug)}` : `sheet-${slug}`)}">
			<h1>${escapeHtml(name)}</h1>
			<table class="meta">
				<tr>
					<th class="player">Player</th>
					<td class="player">${escapeHtml(player)}</td>
					<th class="heropoints">Bennies</th>
				</tr>
				<tr>
					<th class="motivation">Motivation</th>
					<td class="motivation">${escapeHtml(motivation)}</td>
					<td class="heropoints" rowspan="3">
					<span class="current"><em></em><br>Current</span>\t
					<span class="max"><em>${escapeHtml(sheet.bennies?.max ?? heropoints.max)}</em><br>Max</span>
						
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
				${makeNotes([...qualities, ...powers])}
			</section>${makeInventory(sheet.inventory ?? sheet.extras ?? [], sheet.inventory !== undefined)}
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

// Containers are identified by capacity presence: zero is a valid capacity.
const makeInventory = (items: readonly InventoryItem[], references: boolean): string => {
	if (!items.length) return '';
	const byId = new Map(items.filter((item) => item.id).map((item) => [item.id, item]));
	const locationName = (item: InventoryItem): string => {
		if (!references) return item.location;
		const names: string[] = [];
		let location = item.location;
		while (location) {
			const container = byId.get(location);
			if (!container) break; // Metadata validation diagnoses invalid references.
			names.unshift(container.name);
			location = container.location;
		}
		return names.join(' / ');
	};
	const groups = new Map<string, InventoryItem[]>();
	for (const item of items) {
		if (item.capacity !== undefined) {
			const path = [locationName(item), item.name].filter(Boolean).join(' / ');
			if (!groups.has(path)) groups.set(path, []);
			continue;
		}
		const name = locationName(item) || 'Unassigned';
		if (!groups.has(name)) groups.set(name, []);
		groups.get(name)!.push(item);
	}
	return `
<section class="inventory"><h2>Equipment</h2>${[...groups]
		.map(
			([name, contents]) => `
<h3>${escapeHtml(name)}</h3>
<table><thead><tr><th>Item</th><th>Quantity</th><th>Value</th></tr></thead><tbody>${contents.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.count ?? '')}</td><td>${escapeHtml(item.value ?? '')}</td></tr>`).join('')}</tbody></table>`,
		)
		.join('')}</section>`;
};
