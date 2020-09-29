import cheerio from 'cheerio';
import sass from 'sass';
import write from 'write';
import read from './read.js';
import moment from 'moment';

export default async (data, { project, theme }) => {
	const template = await read(`${project}/templates/index.html`);

	const { css } = sass.renderSync({ file: `${project}/templates/${theme}/index.scss` });
	await write(`${project}/templates/index.css`, css);

	// Generate skeleton
	const $ = cheerio.load(template);

	// Group data
	const default_types = JSON.parse(await read(`${project}/data/categories.json`));
	const types = default_types.map(type => ({ ...type, items: [] }));
	data.forEach(item => {
		try {
			types.find(type => type.category === item.type).items.push(item);
		} catch (e) {
			console.error(`Could not find a type entry for category ${item.type} for ${item.title}`);
			console.error({ item });
			throw e;
		}
	});

	// Add data
	types.forEach(type => {
		if (type.items.length === 0) {
			return;
		}
		const entries = type.items.map(item => item.html).join('\n');
		const category_section = `
            <section class="category" id="${type.category}">
                <h1>${type.heading}</h1>
                ${entries}
            </section>
		`;
		$('main').append(category_section);

		// Sheets
		const cs = type.items
			.filter(i => i.sheet)
			.map(generate_character_sheets)
			.join('\n');
		if (cs) {
			$('aside#character-sheets').append(cs);
		}
	});

	const timeline = generate_timeline(types, $);
	if (timeline) {
		$('aside#timeline').append(timeline);
	}

	// Generate string
	return $;
};

const generate_timeline = (types, $) => {
	const results = [];
	types
		.map(type => {
			const items_with_dates = type.items
				.filter(item => item.date)
				.map(item => ({ date: moment(item.date), title: item.title, slug: item.slug, summary: item.summary || [] }));
			return items_with_dates;
		})
		.reduce((acc, cur) => acc.concat(cur), [])
		.sort((a, b) => a.date - b.date)
		.forEach(item => {
			const $date = $('<h2 />').text(item.date.format('Do MMMM YYYY'));
			const $h = $('<h3 />').append(
				$('<a />').addClass('timeline-link').text(item.title).attr('href', `#${item.slug}`)
			);
			const $list = item.summary.map(text => $('<p />').text(text));
			results.push($date, $h, ...$list);
		});

	return results;
};

const generate_character_sheets = ({ slug, sheet }) => {
	const { name, player, motivation, origin, heropoints, qualities, powers } = sheet;

	return `
		<section class="character-sheet" id="sheet-${slug}">
			<h1>${name}</h1>
			<table class="meta">
				<tr>
					<th class="player">Player</th>
					<td class="player">${player}</td>
					<th class="heropoints">Hero Points</th>
				</tr>
				<tr>
					<th class="motivation">Motivation</th>
					<td class="motivation">${motivation}</td>
					<td class="heropoints" rowspan="3">
					<span class="current"><em>${heropoints.current}</em><br>Current</span>	
					<span class="max"><em>${heropoints.max}</em><br>Max</span>
						
					</td>
				</tr>
				<tr>
					<th class="origin">Origin</th>
					<td class="origin">${origin}</td>
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

const makeNotes = powers => {
	const filtered = powers.filter(power => power.notes);
	const md = filtered.map(power => `\n<h2>${power.name}</h2>\n\n<p>${power.notes}</p>`);
	return md.join('\n\n');
};

const makeRows = qualities => qualities.map(makeRow).join('\n');

const levels = [
	{ name: 'MSTR', value: '+6' },
	{ name: 'EXP', value: '+4' },
	{ name: 'GD', value: '+2' },
	{ name: 'AVG', value: '+0' },
	{ name: 'PR', value: '-2' },
];

const makeRow = quality => {
	const index = levels.findIndex(entry => entry.name === quality.value);

	const html = `<tr>
		<td>${quality.name}</td>
	${levels
		.map((level, dex) => `<td class="${dex < index ? 'unobtained' : 'obtained'}">${level.value}</td>`)
		.join('\n')}<td></td></tr>\n`;
	return html;
};
