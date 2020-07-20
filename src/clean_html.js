import cheerio from 'cheerio';

export default data => data.map(clean_html_file);

const clean_html_file = data => {
	const { html, slug, title, alias } = data;
	const aliases = alias || [];
	if (!Array.isArray(aliases)) {
		console.log(`!!Aliases are broken for ${slug}. Did not get an array.`);
		process.exit(2);
	}
	const indexNames = aliases.map(get_index_names_from_aliases).filter(name => !!name);
	indexNames.unshift(title);
	const indexes = JSON.stringify(indexNames).replace(/"/g, '&quot;');
	const $ = cheerio.load(`<section class="entry" id="${slug}">${html}</section>`);
	downgrade_headings($);
	const heading = $('h1');
	heading.replaceWith(`<header><h2 data-index="${indexes}">${heading.html()}</h2></header>`);
	return { ...data, html: $('body').html() };
};

const downgrade_headings = $ => {
	$('h3').each((_index, h) => $(h).replaceWith($('<h4 />').html($(h).html())));
	$('h2').each((_index, h) => $(h).replaceWith($('<h3 />').html($(h).html())));
};

const get_index_names_from_aliases = alias => {
	const { name, index } = alias;
	if (typeof index === 'string') return index;
	if (typeof name === 'string') return name;
	if (typeof alias === 'string') return alias;
};
