import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeConsumerPolicy } from './consumer-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'cross-doc-package-'));
const pnpm = process.env.npm_execpath || 'pnpm';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
	await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
	await writeFile(
		new URL('../dist/stale.cjs', import.meta.url),
		'throw new Error("stale CommonJS artifact");',
	);
	run(pnpm, ['pack', '--pack-destination', temporary], root);
	const archive = (await readdir(temporary)).find((name) => name.endsWith('.tgz'));
	assert.ok(archive, 'pnpm pack must produce a tarball');
	const consumer = join(temporary, 'consumer');
	await cp(new URL('../tests/fixtures/project/', import.meta.url), join(consumer, 'project'), {
		recursive: true,
	});
	await writeFile(
		join(consumer, 'package.json'),
		JSON.stringify({ name: 'cross-doc-esm-consumer', private: true, type: 'module' }),
	);
	const assertPolicyUnchanged = await writeConsumerPolicy(consumer);
	run(pnpm, ['add', join(temporary, archive)], consumer);
	await assertPolicyUnchanged();
	const packageRoot = join(consumer, 'node_modules/cross-doc');
	const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.type, 'module');
	run(pnpm, ['add', '-D', `@types/node@${manifest.devDependencies['@types/node']}`], consumer);
	await assertPolicyUnchanged();
	assert.deepEqual(manifest.exports, {
		'.': { types: './dist/index.d.ts', import: './dist/index.js' },
	});
	const shipped = await readdir(packageRoot);
	const allFiles = await readdir(packageRoot, { recursive: true });
	assert.ok(
		!allFiles.some((name) => name.endsWith('.bak') || name.endsWith('.cjs')),
		'backup/CommonJS files must not ship',
	);
	assert.ok(
		!(await readdir(join(packageRoot, 'dist'))).includes('stale.cjs'),
		'clean build must remove stale output',
	);
	assert.ok(
		!shipped.includes('src') && !shipped.includes('babel.config.js'),
		'ship compiled output only',
	);
	await writeFile(
		join(consumer, 'consumer.mjs'),
		`
import assert from 'node:assert/strict';
import * as api from 'cross-doc';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
assert.throws(() => createRequire(import.meta.url)('cross-doc'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
const expected = ${JSON.stringify(['add_front_matter', 'add_table_of_contents', 'add_title_attributes', 'clean_html', 'generate_graph', 'writeGraph', 'generate_html', 'readCategories', 'inspectProject', 'listThemes', 'validateTheme', 'analyzeLinks', 'loadProject', 'compileProject', 'CompilationError', 'get_files', 'select_files', 'output', 'parse_data', 'read', 'read_files', 'replace_placeholders', 'sort', 'warn_missing_reciprocal_links'].sort())};
assert.deepEqual(Object.keys(api).sort(), expected);
for (const operation of Object.values(api)) assert.equal(typeof operation, 'function');
await assert.rejects(import('cross-doc/dist/read.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
const options = { project: resolve('project'), theme: 'default' };
const files = await api.get_files(options);
const data = api.add_front_matter(api.clean_html(api.parse_data(await api.read_files(files))), options);
const { sort } = await api.sort(options);
const $ = await api.generate_html(sort(data), options);
api.replace_placeholders($);
await api.add_table_of_contents($, options);
api.add_title_attributes($);
assert.equal($('#alice > header h2').text(), 'Alice');
assert.equal($('#alice .see-also a').text(), 'Bob');
assert.equal($('#sheet-alice .player').last().text(), 'Ada');
console.log('Packed ESM consumer: all 24 exports and fixture compilation passed');
`,
	);
	run(process.execPath, ['consumer.mjs'], consumer);
	await writeFile(
		join(consumer, 'consumer.mts'),
		`
import * as api from 'cross-doc';
import type { Options, GenerateHtmlOptions, OutputOptions, GraphOptions, RawDocument, FrontMatter, ParsedEntry, Entry, Alias, AliasDetails, Figure, Quality, Power, QualityLevel, CharacterSheet, Category, HtmlDocument, EntryDate, ProjectOptions, LinkOptions } from 'cross-doc';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const readIsTyped: IsAny<Awaited<ReturnType<typeof api.read>>> = false;
const entriesAreTyped: IsAny<ReturnType<typeof api.parse_data>[number]> = false;
const htmlIsTyped: IsAny<Awaited<ReturnType<typeof api.generate_html>>> = false;
const options: Options = { project: './project', include: ['alice'] };
const project: ProjectOptions = options;
const links: LinkOptions = options;
const graph: GraphOptions = { graph_file_name: 'result.dot' };
const output: OutputOptions = { project: './project', html_file_name: 'out.html', pdf_file_name: 'out.pdf', embedded_html_file_name: 'embedded.html' };
const raw: RawDocument[] = await api.read_files(await api.get_files(options));
const parsed: ParsedEntry[] = api.parse_data(raw);
const entries: Entry[] = api.add_front_matter(api.clean_html(parsed), links);
const htmlOptions: GenerateHtmlOptions = { project: options.project, theme: 'default' };
const html: HtmlDocument = await api.generate_html(entries, htmlOptions);
const date: EntryDate = new Date();
const metadata: FrontMatter = { type: 'person', title: 'Alice', custom: { note: 'extension' }, date };
const aliasDetails: AliasDetails = { name: 'Explorer', secret: false };
const alias: Alias = aliasDetails;
const figure: Figure = { file: 'map.svg', caption: 'Map' };
const level: QualityLevel = 'EXP';
const quality: Quality = { name: 'Courage', value: level };
const power: Power = { name: 'Navigation', value: 'AVG', notes: 'Finds the way' };
const sheet: CharacterSheet = { name: 'Alice', player: 'Ada', origin: 'Explorer', motivation: 'Discovery', heropoints: { current: 2, max: 3 }, qualities: [quality], powers: [power] };
const category: Category = { category: 'event', heading: 'Events', sort: 'date' };
void [readIsTyped, entriesAreTyped, htmlIsTyped, project, graph, output, html, metadata, alias, figure, sheet, category];
// @ts-expect-error missing required project
api.get_files({});
// @ts-expect-error include must contain string slugs
api.get_files({ project: '.', include: [42] });
// @ts-expect-error output paths are required
api.output(html, { project: '.' });
// @ts-expect-error date must be a Date or string
const badDate: FrontMatter = { type: 'person', title: 'Alice', date: 42 };
// @ts-expect-error alias name is a string
const badAlias: Alias = { name: 42 };
// @ts-expect-error category sorting is a documented literal union
const badCategory: Category = { category: 'event', heading: 'Events', sort: 'typo' };
// @ts-expect-error a custom metadata extension is unknown until narrowed
const badExtension: string = metadata.custom;
// @ts-expect-error package exports intentionally prohibit private deep imports
import privateRead from 'cross-doc/dist/read.js';
`,
	);
	await writeFile(
		join(consumer, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				module: 'NodeNext',
				target: 'ES2023',
				strict: true,
				noEmit: true,
				types: ['node'],
			},
			include: ['consumer.mts'],
		}),
	);
	run(resolve(root, 'node_modules/.bin/tsc'), ['-p', join(consumer, 'tsconfig.json')], consumer);
	console.log('Packed declarations resolve under TypeScript 7 NodeNext');
	if (process.argv.includes('--electron')) {
		const { default: checkElectron } = await import('./check-electron.mjs');
		await checkElectron(consumer, pnpm, assertPolicyUnchanged);
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
}
