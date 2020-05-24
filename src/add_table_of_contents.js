"use strict";

export default ($) => {
	const categories = [];

	$(".category").each(
		(i, category) => {
            
			const category_element = $(category);
			const h1 = category_element.find("h1");
			const category_label = h1.text();
			const category_link = `#${category_element.attr("id")}`;
			const entries = [];
			$(category).find(".entry").each(
				(i, entry) => {
					const entry_element = $(entry);
					const h2 = entry_element.find("h2");
					const entry_labels = h2.data("index"); // jQuery compatible so this parses the JSON for me
					const entry_link = `#${entry_element.attr("id")}`;
					if (!entry_labels) {
						throw `Heading missing from the markup of ${entry_link}`;
					}
					const expandedIndex = entry_element.attr("data-toc");
					let expandedIndexHTML = "";
					if (expandedIndex){ 
						let items = [];
						
						entry_element.find("li a:not(.see-also)").each( (index, element) => {
							const e = $(element);
							if (e.is(".entry > header a")) {
								return;
							}
							items.push({ link: e.attr("href"), text: e.text() });
						});
						
						items.sort((a, b) => {
							var A = a.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
							var B = b.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
							if (A < B) 
								return -1;
							if (A > B) 
								return 1;
							return 0;
						});
						const html = [];

						items.forEach( ({link, text}) => html.push(`<li><a class="toc" href="${link}">${text}</a></li>`));

						expandedIndexHTML = `<ul>${html.join("")}</ul>`;
					}
					entry_labels.forEach((entry_label, index) => {
						const html = `<li><a class="toc" href="${entry_link}">${entry_label}</a>${(!index) ? expandedIndexHTML : ""}</li>`;
						entries.push(html);
					});
				}
			);

			const html = `
                <li id="category_${category_element.attr("id")}">
                    <a class="toc" href="${category_link}">${category_label}</a>
                    <ol>
                        ${entries.sort(sort_by_label).join("\n")}
                    </ol>
                </li>
            `;
			categories.push(html);
		}
	);

	{ // Figure "category"
		const entries = [];
		$("figure").each((i, figure) => {
			const $fig = $(figure);
			const entry_link = `#${$fig.attr("id")}`;
			const entry_label = `${$fig.text().trim()}`;
			const html = `<li><a class="toc" href="${entry_link}">${entry_label}</a></li>`;
			entries.push(html);
		});

		if (!entries.length) return;

		const html = `
                <li id="category_figures">
                    <span>Figures</span>
                    <ol>
                        ${entries.join("\n")}
                    </ol>
                </li>
            `;
		categories.push(html);
	}

	const html = `<ol>${categories.join("\n")}</ol>`;
	$("#toc").append(html);
	let previous = "";
	$("#toc > ol > li:not(#category_Events) > ol > li").each((_index, element) => {
		const $e = $(element);
		const firstLetter = $e.text().charAt(0);
		if (firstLetter !== previous) {
			previous = firstLetter;
			$e.addClass("first_of_letter");
		}
	});
};

const expression = /^.*?">/;
const sort_by_label = (a_html, b_html) => {
	const a = a_html.replace(expression, "");
	const b = b_html.replace(expression, "");
	if (a===b) {
		return 0;
	} else if (a < b) {
		return -1;
	} else {
		return 1;
	}
};
