export default ($) => {
	// console.log("Adding title attributes");
	$("a").each(
		(i, a) => {
			// console.log({a, i});
			const href = $(a).attr("href");
			const heading = $(`${href} h2`).text();
			$(a).attr("title", heading);
		}
	);
};
