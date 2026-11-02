import { mkdir, mkdtemp, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompilationError, prepare, runner } from './project.js';
import { generateHtmlWithCategories } from './generate_html.js';
import { validateTheme } from './inspection.js';
import { within } from './layout.js';
import replacePlaceholders from './replace_placeholders.js';
import { addTableOfContentsWithCategories } from './add_table_of_contents.js';
import addTitleAttributes from './add_title_attributes.js';
import { renderPdf } from './output.js';
import {
	canonicalDestination,
	protectDestinations,
	validatePublication,
} from './publication_paths.js';
import { portableDocument, writePublication } from './portable_output.js';
import type {
	Diagnostic,
	PipelineHooks,
	PublicationArtifact,
	PublicationDestination,
	PublicationOptions,
	PublicationPaths,
	PublicationResult,
} from './types.js';

export async function publishProject(
	options: PublicationOptions,
	hooks: PipelineHooks = {},
): Promise<PublicationResult> {
	const artifacts: PublicationArtifact[] = [];
	const diagnostics: Diagnostic[] = [];
	const run = runner(hooks, artifacts, diagnostics);
	let ownedDirectory: string | undefined;
	let failure: unknown;
	let result: PublicationResult | undefined;
	const intermediates: PublicationArtifact[] = [];
	try {
		const loaded = await prepare(
			options,
			(stage, action) =>
				run(stage, () => {
					if (stage === 'discover') validatePublication(options);
					return action();
				}),
			diagnostics,
			hooks,
		);
		const layout = loaded.layout;
		if (!layout) throw new Error('Missing resolved project layout');
		const paths: PublicationPaths = {};
		const html = options.outputs.html;
		const pdf = options.outputs.pdf;
		if (html) {
			paths.html = resolve(html.path);
			artifacts.push({
				kind: html.format === 'linked' ? 'html' : 'embedded-html',
				path: paths.html,
				status: 'not-started',
				role: 'deliverable',
			});
			if (html.format === 'linked') {
				paths.assets = resolve(
					html.assetsDirectory ??
						join(dirname(paths.html), `${basename(paths.html).replace(/\.[^.]*$/, '')}.assets`),
				);
				artifacts.push({
					kind: 'assets',
					path: paths.assets,
					status: 'not-started',
					role: 'deliverable',
				});
			}
		}
		if (pdf) {
			paths.pdf = resolve(pdf.path);
			artifacts.push({ kind: 'pdf', path: paths.pdf, status: 'not-started', role: 'deliverable' });
		}
		const document = await run('render', async () => {
			validateTheme(options.theme, loaded.themes);
			const requested = options.intermediates;
			const explicit = [requested?.cssFile, requested?.htmlFile].filter(
				(value): value is string => value !== undefined,
			);
			const destinations: PublicationDestination[] = artifacts.map((artifact) => ({
				path: artifact.path,
				directory: artifact.kind === 'assets',
				intermediate: false,
			}));
			for (const path of explicit)
				destinations.push({ path: resolve(path), directory: false, intermediate: true });
			await protectDestinations(layout, destinations, options.overwrite === true);
			const stagingParent = resolve(requested?.directory ?? tmpdir());
			// Validate a future child before creating anything; the parent itself is not owned.
			await protectDestinations(
				layout,
				[
					...destinations,
					{
						path: join(stagingParent, `cross-doc-${randomUUID()}`),
						directory: true,
						intermediate: true,
					},
				],
				options.overwrite === true,
			);
			await mkdir(stagingParent, { recursive: true });
			ownedDirectory = await mkdtemp(join(stagingParent, 'cross-doc-'));
			paths.css = requested?.cssFile
				? resolve(requested.cssFile)
				: join(ownedDirectory, 'theme.css');
			paths.intermediateHtml = requested?.htmlFile
				? resolve(requested.htmlFile)
				: join(ownedDirectory, 'document.html');
			// A staging directory must not contain another requested output or vice versa.
			await protectDestinations(
				layout,
				[
					...destinations.filter((dest) => !dest.intermediate),
					{ path: paths.css, directory: false, intermediate: true },
					{ path: paths.intermediateHtml, directory: false, intermediate: true },
				],
				options.overwrite === true,
			);
			// Pin intermediate symlink ancestors before rendering and cleanup.
			await mkdir(dirname(paths.css), { recursive: true });
			await mkdir(dirname(paths.intermediateHtml), { recursive: true });
			paths.css = await canonicalDestination(paths.css);
			paths.intermediateHtml = await canonicalDestination(paths.intermediateHtml);
			ownedDirectory = await realpath(ownedDirectory);
			intermediates.push(
				{
					kind: 'css',
					path: paths.css,
					status: 'unverified',
					role: 'intermediate',
					cleanup: 'unverified',
				},
				{
					kind: 'intermediate-html',
					path: paths.intermediateHtml,
					status: 'not-started',
					role: 'intermediate',
					cleanup: 'unverified',
				},
			);
			artifacts.push(...intermediates);
			const document = await generateHtmlWithCategories(
				loaded.entries,
				{
					project: options.project,
					theme: options.theme,
					css_file_name: paths.css!,
					portableAssets: true,
				},
				loaded.categories,
				layout,
			);
			intermediates[0]!.status = 'completed';
			return document;
		});
		await run('placeholders', () => replacePlaceholders(document));
		await run('toc', () => addTableOfContentsWithCategories(document, loaded.categories));
		await run('titles', () => addTitleAttributes(document));
		await run('output', async () => {
			await protectDestinations(
				layout,
				artifacts
					.filter((item) => item.role === 'deliverable')
					.map((item) => ({
						path: item.path,
						directory: item.kind === 'assets',
						intermediate: false,
					})),
				options.overwrite === true,
			);
			if (html && paths.html) {
				const artifact = artifacts.find((item) => item.path === paths.html)!;
				const assets = artifacts.find((item) => item.kind === 'assets');
				if (assets) assets.status = 'unverified';
				const contents = await portableDocument(
					document,
					layout,
					paths.css!,
					paths.html,
					paths.assets,
				);
				if (assets) assets.status = 'completed';
				artifact.status = 'unverified';
				await writePublication(paths.html, contents, options.overwrite === true);
				artifact.status = 'completed';
			}
			if (pdf && paths.pdf) {
				const intermediate = intermediates[1]!;
				intermediate.status = 'unverified';
				await writePublication(
					paths.intermediateHtml!,
					await portableDocument(document, layout, paths.css!, paths.intermediateHtml!),
					false,
				);
				intermediate.status = 'completed';
				await mkdir(dirname(paths.pdf), { recursive: true });
				const artifact = artifacts.find((item) => item.kind === 'pdf')!;
				artifact.status = 'unverified';
				await writePublication(paths.pdf, '', options.overwrite === true);
				await renderPdf(paths.intermediateHtml!, paths.pdf, pdf.princeBinary);
				const info = await stat(paths.pdf);
				if (!info.isFile() || info.size === 0) throw new Error('Prince did not produce a PDF file');
				artifact.status = 'completed';
			}
		});
		result = { artifacts, diagnostics };
	} catch (error) {
		failure = error;
	}
	try {
		if (options?.intermediates?.keep === true) {
			for (const artifact of intermediates)
				artifact.cleanup = artifact.status === 'not-started' ? 'removed' : 'retained';
			if (
				ownedDirectory &&
				!intermediates.some((artifact) => within(ownedDirectory!, artifact.path))
			)
				await rm(ownedDirectory, { recursive: true, force: true });
		} else {
			for (const artifact of intermediates) {
				if (artifact.status !== 'not-started') await rm(artifact.path, { force: true });
				artifact.cleanup = 'removed';
			}
			if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
		}
	} catch (cleanupError) {
		failure = failure
			? new AggregateError(
					[failure, cleanupError],
					'Publication failed and temporary cleanup failed',
				)
			: cleanupError;
	}
	if (failure) {
		if (failure instanceof CompilationError)
			throw new CompilationError(failure.stage, artifacts, failure.cause, diagnostics);
		throw new CompilationError('output', artifacts, failure, diagnostics);
	}
	if (!result) throw new Error('Publication did not return a result');
	return result;
}
