import cheerio from "cheerio";

export default (data, options) => {
	const map = {};
	data.forEach(extract_links.bind(null, map));
	Object.keys(map).forEach(from => {
		const errors = [];
		Object.keys(map[from]).forEach(to => {
			if (!map[to]) {
				if (options.include && options.include.length) data.forEach(remove_link.bind(null, to));
				return errors.push(`\tlinks to non-existent ${to}\n`);
			}
			if (!map[to][from]) {
				return errors.push(`\tmissing reciprocal link from ${to}\n`);
			}
		});
		if (errors.length) {
			process.stderr.write(`Report for links from ${from}:\n`);
			errors.forEach(error => process.stderr.write(error));
		}        
	});
};

const remove_link = (to, data) => {
	const $ = cheerio.load(data.html);
	const links = $(`a[href="#${to}"]`);
	links.each((_index, link) => {
		const $link = $(link);
		$link.replaceWith($link.html());
	});
	data.html = $.root().html();
};

const extract_links = (map, entry) => {
	const {slug, html, monoDirectionalLinks} = entry;
	if (map[slug]) 
		throw new Error(`Duplicate slug: ${slug}`);
	map[slug] = {};
	const $ = cheerio.load(html);
	$("a").each( (i, elm) => map[slug][$(elm).attr("href").replace(/^#/, "")] = true);
	Object.keys(map[slug]).forEach(key => {
		if (key.indexOf("figure-") === 0) {
			delete map[slug][key];
		}
	});
	if (monoDirectionalLinks) {
		monoDirectionalLinks.forEach(link => {
			if (map[slug][link]) {
				delete map[slug][link];
			} else {
				process.stdout.write(`${slug} is marked as monoDirectionalLinks: ${link} but no such link exists\n`);
			}
		});
	}
};
