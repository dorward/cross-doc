export default $ => {
	$('.see-also a').each((i, a) => {
		const href = $(a).attr('href');
		const heading = $(`${href} h2`).text();
		$(a).text(heading);
	});
	$('figure').each((i, count) =>
		$(count)
			.find('span')
			.text('' + i + 1)
	);
	$('.figure-link').each((i, a) => {
		const href = $(a).attr('href');
		const no = $(`${href} figcaption span`).text();
		$(a).text(`See fig. ${no}`);
	});
};
