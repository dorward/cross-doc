import cheerio from "cheerio";
import moment from "moment";

export default (data) => data.map(add_front_matter_to_html);

const add_front_matter_to_html = (data) => {
	const {html, pc, date, also, figures, slug, expandedIndex, alias} = data;
	const $ = cheerio.load(html);
	const $header = $("header");
	const $section = $("section");
	const annotations = [];

	if (expandedIndex) 
		$section.attr("data-toc", slug);
	if (pc) 
		annotations.push(`<p class="PC">PC: <em>${pc}</em></p>`);
	if (date)
		annotations.push(`<p class="date">${moment(date).format("MMM YYYY")}</p>`);

	generate_also(also, $section);
	const generated_figures = generate_figures(figures, annotations, slug);
	const generated_aliases = generate_aliases(alias);

	if (annotations.length) 
		$header.append(`<aside>${annotations.join("\n")}</aside>`);
	if (generated_figures.length)
		$section.append(generated_figures.join("\n"));
	if (generated_aliases) {
		$header.after(generated_aliases);
	}

	return {...data, html: $("body").html() };
};

const generate_aliases = (alias) => {
	if (!alias) return;
	const aliases = [];
	alias.forEach(alias => {
		let { name, note } = alias;
		if (typeof name !== "string") name = alias;

		let text = name;
		if (note) {
			text = `${name} (${note})`;
		}
		aliases.push(`<li>${text}</li>`);
	});
	return `<aside class="aliases">
	<h3>Alias${aliases.length > 2 ? "es" : ""}</h3>
	<ul>
		${aliases.join("\n\t\t")}
	</ul>
</aside>`;
};

const generate_also = (also, $section) => {
	if (also) {
		const html = also.sort().map(
			item => 
				`<li><a class="see-also" href="#${item}">Placeholder</a></li>`
		).join("\n");
		$section.append("<div class=\"see-also\">See also: <ul>" + html + "</ul></div>");
	}
};

const generate_figures = (figures, annotations, slug) => {
	const generated_figures = [];
	if (figures) {
		figures.forEach(data => {
			const id = `figure-${slug}`;
			const link = `<a class="figure-link" href="#${id}">Figure Link Placeholder</a>`;
			annotations.push(link);

			const html = `
			<figure id="${id}">
				<div><img src=../resources/${data.file}></div>
				<figcaption>fig. <span>figcount</span> ${data.caption}</figcaption>
			</figure>`;
			generated_figures.push(html);
		});
	}
	return generated_figures;
};