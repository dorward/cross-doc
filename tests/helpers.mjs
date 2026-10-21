import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../src/index.ts';

export async function projectFixture() {
	const project = await mkdtemp(join(tmpdir(), 'cross-doc-fixture-'));
	await cp(new URL('./fixtures/project/', import.meta.url), project, { recursive: true });
	return { project, cleanup: () => rm(project, { recursive: true, force: true }) };
}

export async function compile(project) {
	const options = { project, theme: 'default' };
	const files = await api.get_files(options);
	const raw = await api.read_files(files);
	const parsed = api.parse_data(raw);
	const data = api.add_front_matter(api.clean_html(parsed), options);
	api.warn_missing_reciprocal_links(data, options);
	const { sort } = await api.sort(options);
	const $ = await api.generate_html(sort(data), options);
	api.replace_placeholders($);
	await api.add_table_of_contents($, options);
	api.add_title_attributes($);
	return { $, data, parsed };
}
