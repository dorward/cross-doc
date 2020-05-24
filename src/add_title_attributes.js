export default ($) => {
	$("a").each(
		(i, a) => {
			const href = $(a).attr("href");
			const heading = $(`${href} h2`).text();
			$(a).attr("title", heading);
		}
	);
};
