import { marked } from 'marked';
import { loadFront } from 'yaml-front-matter';
import { basename } from 'path';

export default data => data.map(parse_datum);

const parse_datum = datum => {
	const { path, contents } = datum;
	const filename = basename(path);
	const slug = filename.replace(/\.md/, '');
	try {
		const parsed = loadFront(contents);
		if (!parsed.type) throw "Missing mandatory 'type' attribute in the front matter";
		if (!parsed.title) throw "Missing mandatory 'title' attribute in the front matter";
		const html = marked.parse(parsed.__content, { smartLists: true, smartypants: true });
		return { html, path, slug, ...parsed };
	} catch (e) {
		process.stderr.write(`Error handling ${slug}: ${e}`);
		process.exit();
	}
};
