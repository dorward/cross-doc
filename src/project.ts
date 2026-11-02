import { basename, dirname, resolve } from 'node:path';
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
import { resolveProjectLayout } from './layout.js';
import { canonicalReference, discoverFiles, indexWithLayout } from './project_index.js';
import { needsLinkResolution, resolveLinks } from './resolve_links.js';
import { copyDiagnostic } from './internal/diagnostics.js';
import { normalizeCompatibility } from './compatibility.js';
import type {
	PublicationArtifact,
	RunStage,
	ProjectIndex,
	ResolvedProjectLayout,
	ProjectInspection,
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
	readonly artifacts: readonly PublicationArtifact[];
	constructor(
		stage: CompilationStage,
		artifacts: readonly PublicationArtifact[],
		cause: unknown,
		diagnostics: readonly Diagnostic[] = [],
	) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = 'CompilationError';
		this.diagnostics = diagnostics.map(copyDiagnostic);
		this.stage = stage;
		this.artifacts = artifacts.map((artifact) => ({ ...artifact }));
	}
}

export function runner(
	hooks: PipelineHooks,
	artifacts: PublicationArtifact[],
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

export async function prepare(
	options: ProjectOptions & LinkOptions,
	run: RunStage,
	diagnostics: Diagnostic[],
	hooks: PipelineHooks,
	onLayout?: (layout: ResolvedProjectLayout) => void,
): Promise<LoadedProject> {
	let index: ProjectIndex | undefined;
	let inspection: ProjectInspection | undefined;
	const discovery = await run('discover', async () => {
		const layout = await resolveProjectLayout(options);
		const paths = await discoverFiles(layout);
		return {
			layout,
			allPaths: paths,
			paths: layout.identity === 'legacy' ? selectFiles(paths, options.include) : paths,
		};
	});
	const { layout: resolvedLayout, paths: discovered } = discovery;
	onLayout?.(resolvedLayout);
	let files = discovered;
	let includes = options.include;
	if (resolvedLayout.identity === 'vault-path-v1') {
		inspection = await run('inspect', () => inspectProject(options, resolvedLayout));
		const indexed = await run('index', async () => {
			const full = await indexWithLayout(resolvedLayout, discovered);
			return { index: full, files: selectFiles(discovered, options.include, full) };
		});
		index = indexed.index;
		files = indexed.files;
		if (options.include) {
			const fullIndex = index;
			includes = options.include.map((value) => canonicalReference(value, fullIndex));
			for (const value of options.include) {
				const target = canonicalReference(value, fullIndex);
				if (target !== value)
					diagnostics.push({
						code: 'legacy-reference',
						severity: 'warning',
						source: target,
						target: value,
					});
			}
		}
	}
	const selectedOptions = { ...options, ...(includes ? { include: includes } : {}) };
	const raw = await run('read', () => readFiles(files));
	let normalized = await run('parse', () => {
		const parsed = parseData(raw, index);
		return index ? normalizeCompatibility(parsed, index, diagnostics) : parsed;
	});
	if (
		index ||
		needsLinkResolution(
			normalized,
			new Set(discovery.allPaths.map((path) => basename(path, '.md'))),
		)
	) {
		const resolved = await run('resolve', async () =>
			resolveLinks(
				normalized,
				index ?? (await indexWithLayout(resolvedLayout, discovery.allPaths)),
			),
		);
		normalized = resolved.entries;
		diagnostics.push(...resolved.diagnostics);
	}
	const cleaned = await run('clean', () => cleanHtml(normalized));
	const entries = await run('metadata', () => addFrontMatter(cleaned, selectedOptions, index));
	await run('links', () => {
		for (const diagnostic of analyzeLinks(entries, selectedOptions, index))
			diagnostics.push(diagnostic);
		const distinct = new Map(diagnostics.map((item) => [JSON.stringify(item), item]));
		diagnostics.splice(0, diagnostics.length, ...distinct.values());
		hooks.onDiagnostics?.(diagnostics.map(copyDiagnostic));
	});
	return run('sort', async () => {
		const inspected = inspection ?? (await inspectProject(options, resolvedLayout));
		return {
			...inspected,
			layout: resolvedLayout,
			...(index ? { index } : {}),
			diagnostics,
			entries: sortCategories(inspected.categories).sort(entries),
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
		path: options.css_file_name
			? resolve(options.css_file_name)
			: resolve(options.project, 'templates/index.css'),
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
	const { entries, categories, themes, layout } = await prepare(
		options,
		run,
		diagnostics,
		hooks,
		(resolvedLayout) => {
			if (resolvedLayout.identity === 'vault-path-v1')
				css.path = options.css_file_name
					? resolve(options.css_file_name)
					: resolve(dirname(options.html_file_name), 'cross-doc.css');
		},
	);
	const html = await run('render', async () => {
		validateTheme(options.theme, themes);
		css.status = 'unverified';
		const document = await generateHtmlWithCategories(
			entries,
			{ ...options, css_file_name: css.path },
			categories,
			layout,
		);
		css.status = 'completed';
		return document;
	});
	await run('placeholders', () => replacePlaceholders(html));
	await run('toc', () => addTableOfContentsWithCategories(html, categories));
	await run('titles', () => addTitleAttributes(html));
	await run('output', async () => {
		const outputs = artifacts.slice(1);
		for (const artifact of outputs) artifact.status = 'unverified';
		await output(html, { ...options, css_file_name: css.path });
		for (const artifact of outputs) artifact.status = 'completed';
	});
	return { artifacts, diagnostics };
}
