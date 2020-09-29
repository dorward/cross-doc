import Prince from 'prince';
import write from 'write';
import data from 'datauri';

export default async ($, options) => {
	const { html_file_name, pdf_file_name, embedded_html_file_name } = options;
	const simplehtml = $.root().html();
	await write(html_file_name, simplehtml);

	try {
		await Prince()
			.timeout(30 * 1000)
			.maxbuffer(3 * 10485760)
			.inputs(html_file_name)
			.output(pdf_file_name)
			.execute();
	} catch (e) {
		console.log('Prince error');
		console.log({ stdout: e.stdout.toString(), stderr: e.stderr.toString(), e });
	}

	const images = [];
	const hrefs = [];
	$('img').each((i, element) => images.push(element));

	$("[href]:not([href^='#'])").each((i, element) => hrefs.push(element));

	for (let i = 0; i < images.length; i++) {
		const $image = $(images[i]);
		const url = $image.attr('src').replace('../', `${options.project}/`);
		try {
			const new_url = await data(url);
			$image.attr('src', new_url);
		} catch (e) {
			console.log({
				msg: `Failed encoding image: ${url}`,
				e,
			});
			throw e;
		}
	}

	for (let i = 0; i < hrefs.length; i++) {
		const $href = $(hrefs[i]);
		const url = $href.attr('href').replace('../', `${options.project}/`);
		try {
			const new_url = await data(url);
			$href.attr('href', new_url);
		} catch (e) {
			console.log({
				msg: `Failed encoding href: ${url} / ${$href.text()}`,
				e,
				url,
			});
			throw e;
		}
	}

	const html = $.root().html();

	await write(embedded_html_file_name, html);
};
