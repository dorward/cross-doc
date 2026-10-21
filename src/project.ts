import { resolve } from 'node:path';
import getFiles from './get_files.js';
import selectFiles from './select_files.js';
import readFiles from './read_files.js';
import parseData from './parse_data.js';
import cleanHtml from './clean_html.js';
import addFrontMatter from './add_front_matter.js';
import { analyzeLinks } from './warn_missing_reciprocal_links.js';
import { sortCategories } from './sort.js';
import { inspectProject, validateTheme } from './inspection.js';
import { generateHtmlWithCategories } from './generate_html.js';
import replacePlaceholders from './replace_placeholders.js';
import { addTableOfContentsWithCategories } from './add_table_of_contents.js';
import addTitleAttributes from './add_title_attributes.js';
import output from './output.js';
import type {
	Diagnostic,
	CompilationArtifact,
	CompilationOptions,
	CompilationResult,
	CompilationStage,
	LinkOptions,
	LoadedProject,
	PipelineHooks,
	ProjectOptions,
} from './types.js';

export class CompilationError extends Error {
	readonly diagnostics: readonly Diagnostic[];
	readonly stage: CompilationStage;
	readonly artifacts: readonly CompilationArtifact[];
	constructor(
		stage: CompilationStage,
		artifacts: readonly CompilationArtifact[],
		cause: unknown,
		diagnostics: readonly Diagnostic[] = [],
	) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = 'CompilationError';
		this.diagnostics = diagnostics.map((diagnostic) => ({ ...diagnostic }));
		this.stage = stage;
		this.artifacts = artifacts.map((artifact) => ({ ...artifact }));
	}
}

type RunStage = <T>(stage: CompilationStage, action: () => T | Promise<T>) => Promise<T>;
function runner(
	hooks: PipelineHooks,
	artifacts: CompilationArtifact[],
	diagnostics: Diagnostic[],
): RunStage {
	return async (stage, action) => {
		try {
			hooks.onProgress?.({ stage, status: 'started' });
			const value = await action();
			hooks.onProgress?.({ stage, status: 'completed' });
			return value;
		} catch (cause) {
			throw new CompilationError(stage, artifacts, cause, diagnostics);
		}
	};
}

async function prepare(
	options: ProjectOptions & LinkOptions,
	run: RunStage,
	diagnostics: Diagnostic[],
	hooks: PipelineHooks,
): Promise<LoadedProject> {
	const files = await run('discover', async () =>
		selectFiles(await getFiles({ project: options.project }), options.include),
	);
	const raw = await run('read', () => readFiles(files));
	const parsed = await run('parse', () => parseData(raw));
	const cleaned = await run('clean', () => cleanHtml(parsed));
	const entries = await run('metadata', () => addFrontMatter(cleaned, options));
	await run('links', () => {
		for (const diagnostic of analyzeLinks(entries, options)) diagnostics.push(diagnostic);
		hooks.onDiagnostics?.(diagnostics.map((item) => ({ ...item })));
	});
	return run('sort', async () => {
		const inspection = await inspectProject(options.project);
		return {
			...inspection,
			diagnostics,
			entries: sortCategories(inspection.categories).sort(entries),
		};
	});
}

// Preparation reads project sources but does not generate CSS, invoke Prince or write output.
export function loadProject(
	options: ProjectOptions & LinkOptions,
	hooks: PipelineHooks = {},
): Promise<LoadedProject> {
	const diagnostics: Diagnostic[] = [];
	return prepare(options, runner(hooks, [], diagnostics), diagnostics, hooks);
}

export async function compileProject(
	options: CompilationOptions,
	hooks: PipelineHooks = {},
): Promise<CompilationResult> {
	const css: CompilationArtifact = {
		kind: 'css',
		path: resolve(options.project, 'templates/index.css'),
		status: 'not-started',
	};
	const artifacts: CompilationArtifact[] = [
		css,
		{ kind: 'html', path: resolve(options.html_file_name), status: 'not-started' },
		{ kind: 'pdf', path: resolve(options.pdf_file_name), status: 'not-started' },
		{
			kind: 'embedded-html',
			path: resolve(options.embedded_html_file_name),
			status: 'not-started',
		},
	];
	const diagnostics: Diagnostic[] = [];
	const run = runner(hooks, artifacts, diagnostics);
	const { entries, categories, themes } = await prepare(options, run, diagnostics, hooks);
	const html = await run('render', async () => {
		validateTheme(options.theme, themes);
		css.status = 'unverified';
		const document = await generateHtmlWithCategories(entries, options, categories);
		css.status = 'completed';
		return document;
	});
	await run('placeholders', () => replacePlaceholders(html));
	await run('toc', () => addTableOfContentsWithCategories(html, categories));
	await run('titles', () => addTitleAttributes(html));
	await run('output', async () => {
		const outputs = artifacts.slice(1);
		for (const artifact of outputs) artifact.status = 'unverified';
		await output(html, options);
		for (const artifact of outputs) artifact.status = 'completed';
	});
	return { artifacts, diagnostics };
}
