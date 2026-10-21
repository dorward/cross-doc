import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as api from 'cross-doc';

export async function compile(project, pdf = false, binary) {
	const expected = [
		'add_front_matter',
		'add_table_of_contents',
		'add_title_attributes',
		'clean_html',
		'generate_graph',
		'writeGraph',
		'generate_html',
		'get_files',
		'select_files',
		'loadProject',
		'compileProject',
		'CompilationError',
		'readCategories',
		'inspectProject',
		'listThemes',
		'validateTheme',
		'analyzeLinks',
		'output',
		'parse_data',
		'read',
		'read_files',
		'replace_placeholders',
		'sort',
		'warn_missing_reciprocal_links',
	];
	assert.deepEqual(Object.keys(api).sort(), expected.sort());
	const options = { project, theme: 'default' };
	const entries = api.add_front_matter(
		api.clean_html(api.parse_data(await api.read_files(await api.get_files(options)))),
		options,
	);
	api.warn_missing_reciprocal_links(entries, options);
	const { sort } = await api.sort(options);
	const $ = await api.generate_html(sort(entries), options);
	api.replace_placeholders($);
	await api.add_table_of_contents($, options);
	api.add_title_attributes($);
	assert.equal($('#alice > header h2').text(), 'Alice');
	assert.equal($('#alice .see-also a').text(), 'Bob');
	assert.equal($('#sheet-alice .player').last().text(), 'Ada');
	await api.writeGraph($, { graph_file_name: join(project, 'out/graph.dot') });
	assert.match(await readFile(join(project, 'out/graph.dot'), 'utf8'), /digraph G/);
	if (pdf) {
		const filename = join(project, 'out/document.pdf');
		await api.output($, {
			project,
			html_file_name: join(project, 'out/document.html'),
			pdf_file_name: filename,
			embedded_html_file_name: join(project, 'out/embedded.html'),
			...(binary ? { prince_binary: binary } : {}),
		});
		assert.equal((await readFile(filename)).subarray(0, 5).toString(), '%PDF-');
		assert.match(
			await readFile(join(project, 'out/embedded.html'), 'utf8'),
			/data:image\/svg\+xml;base64,/,
		);
	}
	return {
		exports: Object.keys(api).length,
		electron: process.versions.electron,
		node: process.versions.node,
		pdf,
	};
}
