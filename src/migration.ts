import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { load } from 'cheerio';
import { relativeProjectPath, resolveProjectLayout, within } from './layout.js';
import { canonicalDestination } from './publication_paths.js';
import { entryId, figureId, idHref, portablePathKey } from './project_index.js';
import { loadProject } from './project.js';
import parseData from './parse_data.js';
import { inlineFigureCount } from './inline_figures.js';
import { headingMarkdown, markdown } from './markdown.js';
import {
	applyPatches,
	figureMarkdown,
	markdownPatches,
	migrationHeader,
} from './migration_markdown.js';
import { rewriteHtml, stylesheetPatches } from './migration_templates.js';
import { externalAsset } from './assets.js';
import type {
	MigrationInput,
	MigrationOptions,
	MigrationPatch,
	MigrationPlan,
	MigrationRewrite,
	VaultProjectConfig,
} from './types.js';

export const migrationHash = (value: string | Uint8Array): string =>
	createHash('sha256').update(value).digest('hex');
export const migrationConfig: VaultProjectConfig = {
	version: 1,
	identity: 'vault-path-v1',
	paths: {
		entries: 'notes',
		attachments: 'attachments',
		categories: 'publishing/categories.json',
		layout: 'publishing/layout.html',
		themes: 'publishing/themes',
		legacyLinks: 'publishing/legacy-links.json',
	},
};
export const migrationJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const migrationUrl = (value: string): string =>
	value
		.split('/')
		.map((part) =>
			encodeURIComponent(part).replace(
				/[!'()*]/g,
				(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
			),
		)
		.join('/');

export async function migrationInventory(project: string): Promise<MigrationInput[]> {
	const inputs: MigrationInput[] = [];
	const walk = async (path: string): Promise<void> => {
		const info = await lstat(join(project, path));
		if (info.isSymbolicLink()) throw new Error(`Migration input symlinks require review: ${path}`);
		if (info.isDirectory()) {
			for (const name of (await readdir(join(project, path))).sort()) await walk(`${path}/${name}`);
		} else if (info.isFile())
			inputs.push({
				path,
				sha256: migrationHash(await readFile(join(project, path))),
				mode: info.mode & 0o777,
			});
		else throw new Error(`Unsupported migration input kind: ${path}`);
	};
	for (const path of ['data', 'templates', 'resources', 'cover', 'report.md']) {
		try {
			await lstat(join(project, path));
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
			throw error;
		}
		await walk(path);
	}
	return inputs;
}

export async function planMigration(options: MigrationOptions): Promise<MigrationPlan> {
	const project = await realpath(options.project);
	const plan: MigrationPlan = {
		version: 1,
		project,
		alreadyMigrated: false,
		inputs: [],
		operations: [],
		edits: [],
		figures: [],
		legacyLinks: { version: 1, entries: [], figures: [] },
		idMap: Object.create(null) as Record<string, string>,
		issues: [],
		diagnostics: [],
	};
	const issue = (code: string, source: string, message: string): void => {
		plan.issues.push({ severity: 'error', code, source, message });
	};
	const moves = new Map<string, NonNullable<MigrationOptions['moves'][number]>>();
	const targets = new Map<string, string>();
	for (const move of options.moves) {
		relativeProjectPath(move.source, 'Migration source');
		if (move.source.startsWith('.git/') || move.source.startsWith('.obsidian/'))
			throw new Error('Migration must not move project/editor internals');
		if (moves.has(move.source)) throw new Error(`Duplicate migration source: ${move.source}`);
		if (move.target) {
			relativeProjectPath(move.target, 'Migration target');
			if (!/^(?:notes|attachments|publishing|artwork|drafts)\//.test(move.target))
				throw new Error(`Target is outside the migration layout: ${move.target}`);
			const key = portablePathKey(move.target);
			if (
				[...targets.keys()].some(
					(previous) =>
						previous === key || previous.startsWith(`${key}/`) || key.startsWith(`${previous}/`),
				)
			)
				issue(
					'path-collision',
					move.source,
					`Target collides with ${targets.get(key)}: ${move.target}`,
				);
			targets.set(key, move.source);
		}
		moves.set(move.source, move);
		if (move.review)
			plan.issues.push({
				severity: 'review',
				code: 'reviewed-retention',
				source: move.source,
				message: move.review,
			});
	}
	for (const [source, target] of [
		['data/categories.json', 'publishing/categories.json'],
		['templates/index.html', 'publishing/layout.html'],
	]) {
		if (moves.get(source!)?.target !== target)
			issue('layout-contract', source!, `Required layout move: ${target}`);
	}
	if (moves.get('templates/index.css')?.target)
		issue(
			'generated-input',
			'templates/index.css',
			'Generated CSS must be retained for review, not migrated as an input',
		);
	const layout = await resolveProjectLayout({
		project,
		...(options.configFile ? { configFile: options.configFile } : {}),
	});
	if (layout.identity === 'vault-path-v1') {
		// No rewriting already-authored vaults. Verify this move map is actually complete first.
		for (const move of options.moves.filter((move) => move.target)) {
			try {
				await lstat(join(project, move.source));
				issue(
					'partial-migration',
					move.source,
					'Legacy input still exists beside a configured vault',
				);
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
			}
			try {
				await lstat(join(project, move.target!));
			} catch {
				issue('missing-target', move.source, `Expected migrated target is absent: ${move.target}`);
			}
		}
		const loaded = await loadProject({ project });
		for (const move of options.moves.filter(
			(move) => move.source.startsWith('data/') && move.source.endsWith('.md') && move.target,
		)) {
			const source = await readFile(join(project, move.target!), 'utf8');
			if (migrationHeader(source).figuresRange)
				issue(
					'partial-migration',
					move.target!,
					'Figures frontmatter still exists in a migrated note',
				);
			const alias = loaded.index?.legacyLinks.entries.find(
				(entry) => entry.legacySlug === posix.basename(move.source, '.md'),
			);
			if (alias?.target !== move.target!.slice(0, -3))
				issue(
					'partial-migration',
					move.target!,
					'Legacy entry mapping does not match the reviewed move map',
				);
		}
		plan.diagnostics = loaded.diagnostics;
		plan.alreadyMigrated = !plan.issues.some((item) => item.severity === 'error');
		return plan;
	}
	plan.inputs = await migrationInventory(project);
	const inputMap = new Map(plan.inputs.map((input) => [input.path, input]));
	for (const input of plan.inputs) {
		const move = moves.get(input.path);
		if (!move)
			issue('uninventoried-source', input.path, 'Input is absent from the reviewed move map');
		else if (move.sha256 && move.sha256 !== input.sha256)
			issue('stale-source', input.path, 'Input hash differs from the reviewed move map');
	}
	for (const move of options.moves)
		if (!inputMap.has(move.source))
			issue('missing-source', move.source, 'Move-map source is absent');
	for (const move of options.moves)
		if (move.target) {
			if (inputMap.has(move.target))
				issue('occupied-target', move.source, `Target is also an input: ${move.target}`);
			try {
				await lstat(join(project, move.target));
				issue('occupied-target', move.source, `Target already exists: ${move.target}`);
			} catch (error) {
				if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
			}
			const actual = await canonicalDestination(join(project, move.target));
			if (!within(project, actual))
				issue('unsafe-target', move.source, `Target escapes the project: ${move.target}`);
		}
	const notes = plan.inputs.filter(
		(input) => input.path.startsWith('data/') && input.path.endsWith('.md'),
	);
	for (const note of notes) {
		const target = moves.get(note.path)?.target;
		if (
			!target?.startsWith('notes/') ||
			!target.endsWith('.md') ||
			posix.basename(target) !== posix.basename(note.path)
		) {
			issue('invalid-note-move', note.path, 'Notes must retain their basenames under notes/');
			continue;
		}
		const legacySlug = posix.basename(note.path, '.md');
		if (['__proto__', 'prototype', 'constructor'].includes(legacySlug))
			issue(
				'unsafe-slug',
				note.path,
				'Legacy slug cannot be represented safely in the output ID map',
			);
		if (plan.legacyLinks.entries.some((entry) => entry.legacySlug === legacySlug))
			issue('duplicate-slug', note.path, `Ambiguous legacy basename: ${legacySlug}`);
		plan.legacyLinks.entries.push({ legacySlug, target: target.slice(0, -3) });
		plan.idMap[legacySlug] = entryId(target.slice(0, -3));
		plan.idMap[`sheet-${legacySlug}`] =
			`sheet/${target.slice(0, -3).split('/').map(encodeURIComponent).join('/')}`;
	}
	let loaded: Awaited<ReturnType<typeof loadProject>> | undefined;
	try {
		loaded = await loadProject({ project });
		plan.diagnostics = loaded.diagnostics;
		for (const entry of loaded.entries) {
			const owner = plan.legacyLinks.entries.find((item) => item.legacySlug === entry.slug);
			if (!owner) continue;
			const $ = load(entry.html);
			const expected =
				(entry.figures?.length ?? 0) +
				inlineFigureCount(markdown.parse(entry.__content, { async: false }));
			if ($('figure').length !== expected)
				throw new Error('Existing raw HTML figures require a manual authoring/mapping decision');
			$('figure').each((index, element) => {
				const id = $(element).attr('id');
				if (!id) throw new Error('Existing raw figures need an explicit migration mapping');
				plan.legacyLinks.figures.push({ legacyId: id, target: owner.target, ordinal: index + 1 });
				plan.idMap[id] = figureId(owner.target, index + 1);
			});
		}
		for (const category of loaded.categories)
			plan.idMap[category.category] = `category/${encodeURIComponent(category.category)}`;
	} catch (error) {
		issue('invalid-project', 'data', error instanceof Error ? error.message : String(error));
	}
	const bySlug = new Map(
		plan.legacyLinks.entries.map((entry) => [entry.legacySlug, `${entry.target}.md`]),
	);
	if (loaded)
		for (const entry of loaded.entries)
			for (const value of [...(entry.also ?? []), ...(entry.monoDirectionalLinks ?? [])])
				if (!bySlug.has(value))
					issue('missing-metadata-target', entry.slug, `Unresolved relationship: ${value}`);
	const locals = new Map<string, Set<string>>();
	for (const note of notes) {
		try {
			const content = await readFile(join(project, note.path), 'utf8');
			const header = migrationHeader(content);
			const $ = load(headingMarkdown.parse(content.slice(header.bodyStart), { async: false }));
			locals.set(
				note.path,
				new Set(
					$('[id], [name]')
						.toArray()
						.flatMap((node) => [$(node).attr('id'), $(node).attr('name')])
						.filter((value): value is string => !!value),
				),
			);
		} catch (error) {
			issue('frontmatter', note.path, error instanceof Error ? error.message : String(error));
		}
	}
	for (const input of plan.inputs.filter(
		(input) => input.path.endsWith('.html') || input.path.endsWith('.svg'),
	)) {
		const $ = load(await readFile(join(project, input.path), 'utf8'));
		locals.set(
			input.path,
			new Set(
				$('[id], [name]')
					.toArray()
					.flatMap((node) => [$(node).attr('id'), $(node).attr('name')])
					.filter((value): value is string => !!value),
			),
		);
	}
	const dependencies = new Map<string, Set<string>>();
	const rewrite: MigrationRewrite = (reference, kind, source, target) => {
		if (!reference || reference === '#' || (externalAsset(reference) && !reference.startsWith('#')))
			return reference;
		const from = posix.dirname(source),
			to = posix.dirname(target);
		if (reference.startsWith('#')) {
			if (kind !== 'link') return reference;
			let token: string;
			try {
				token = decodeURIComponent(reference.slice(1));
			} catch {
				issue('malformed-link', source, reference);
				return reference;
			}
			const note = bySlug.get(token);
			if (note)
				return source.startsWith('templates/')
					? idHref(entryId(note.slice(0, -3)))
					: migrationUrl(posix.relative(to, note));
			if (plan.legacyLinks.figures.some((item) => item.legacyId === token)) {
				issue(
					'authored-figure-reference',
					source,
					`Compiler figure reference needs an Obsidian authoring decision: ${reference}`,
				);
				return reference;
			}
			if (locals.get(source)?.has(token)) {
				plan.issues.push({
					severity: 'review',
					code: 'retained-local-anchor',
					source,
					message: `Retained local anchor: ${reference}`,
				});
				return reference;
			}
			issue('missing-link', source, `Unresolved fragment: ${reference}`);
			return reference;
		}
		const raw = reference.split(/[?#]/, 1)[0] ?? '';
		let decoded: string;
		try {
			decoded = raw
				.split('/')
				.map((part) => {
					const value = decodeURIComponent(part);
					if (value.includes('/') || value.includes('\\') || value.includes('\0'))
						throw new Error('encoded separator');
					return value;
				})
				.join('/');
			if (decoded.startsWith('/') || decoded.includes('\\')) throw new Error('absolute path');
		} catch {
			issue('malformed-link', source, reference);
			return reference;
		}
		let candidate = posix.normalize(posix.join(from, decoded));
		if (kind === 'module') {
			const filename = posix.basename(candidate),
				directory = posix.dirname(candidate);
			const candidates = [
				candidate,
				`${candidate}.scss`,
				`${candidate}.css`,
				posix.join(directory, `_${filename}.scss`),
				posix.join(directory, `_${filename}`),
				posix.join(candidate, '_index.scss'),
				posix.join(candidate, 'index.scss'),
			].filter((path) => inputMap.has(path));
			if (candidates.length !== 1) {
				issue('module-resolution', source, `Missing or ambiguous stylesheet module: ${reference}`);
				return reference;
			}
			candidate = candidates[0]!;
		} else if (!inputMap.has(candidate)) {
			if (inputMap.has(`${candidate}.md`)) candidate += '.md';
			else if (inputMap.has(decoded)) candidate = decoded;
		}
		// The compiled theme link is replaced by the renderer, not moved as an input.
		if (source === 'templates/index.html' && candidate === 'templates/index.css')
			return 'cross-doc.css';
		const move = moves.get(candidate);
		if (!move?.target) {
			issue(
				'missing-dependency',
				source,
				`No reviewed destination for ${reference} (${candidate})`,
			);
			return reference;
		}
		if (kind !== 'link') {
			const edges = dependencies.get(source) ?? new Set<string>();
			edges.add(candidate);
			dependencies.set(source, edges);
		}
		const suffix = reference.slice(raw.length);
		if (candidate.endsWith('.md') && suffix && suffix !== '#') {
			issue(
				'heading-reference',
				source,
				`Only whole-note file links are automatically migrated: ${reference}`,
			);
			return reference;
		}
		const relative = posix.relative(to, move.target);
		if (kind === 'module')
			return relative === posix.relative(from, candidate) ? reference : relative;
		return migrationUrl(relative) + suffix;
	};
	const categories = loaded?.categories.map((category) => category.category) ?? [];
	for (const input of plan.inputs) {
		const target = moves.get(input.path)?.target;
		if (!target) continue;
		try {
			let contents: string | undefined;
			let patches: MigrationPatch[] = [];
			if (input.path.startsWith('data/') && input.path.endsWith('.md')) {
				const text = await readFile(join(project, input.path), 'utf8');
				const header = migrationHeader(text);
				const body = text.slice(header.bodyStart);
				patches = markdownPatches(body, input.path, target, rewrite).map((patch) => ({
					...patch,
					start: patch.start + header.bodyStart,
					end: patch.end + header.bodyStart,
				}));
				if (header.figuresRange)
					patches.push({
						start: header.figuresRange[0],
						end: header.figuresRange[1],
						text: '',
						kind: 'remove-figures-frontmatter',
					});
				const eol = text.includes('\r\n') ? '\r\n' : '\n';
				const blocks: string[] = [];
				const [parsed] = parseData([{ path: join(project, input.path), contents: text }]);
				const existing = inlineFigureCount(parsed!.html);
				for (const [index, figure] of header.figures.entries()) {
					const file = posix.normalize(posix.join('resources', figure.file));
					const attachment = moves.get(file)?.target;
					if (
						!file.startsWith('resources/') ||
						!attachment?.startsWith('attachments/') ||
						!inputMap.has(file)
					)
						throw new Error(`Figure resource has no reviewed attachment move: ${figure.file}`);
					const markdown = figureMarkdown(
						migrationUrl(posix.relative(posix.dirname(target), attachment)),
						figure.caption,
						eol,
					);
					blocks.push(markdown);
					plan.figures.push({
						source: input.path,
						target,
						ordinal: existing + index + 1,
						file,
						attachment,
						caption: figure.caption,
						markdown,
					});
				}
				if (blocks.length)
					patches.push({
						start: text.length,
						end: text.length,
						text:
							(text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol) +
							blocks.join(eol + eol) +
							eol,
						kind: 'append-inline-figures',
					});
				contents = applyPatches(text, patches);
			} else if (
				input.path.startsWith('templates/') &&
				(input.path.endsWith('.scss') ||
					input.path.endsWith('.css') ||
					input.path.endsWith('.html'))
			) {
				const text = await readFile(join(project, input.path), 'utf8');
				patches = input.path.endsWith('.html')
					? rewriteHtml(text, input.path, target, rewrite, true)
					: stylesheetPatches(text, input.path, target, rewrite, categories);
				contents = applyPatches(text, patches);
			} else if (input.path.endsWith('.svg')) {
				const text = await readFile(join(project, input.path), 'utf8');
				const patches = rewriteHtml(text, input.path, target, rewrite, false);
				const $ = load(text);
				for (const node of $('style, *').toArray()) {
					if ($(node).is('style'))
						patches.push(...stylesheetPatches($(node).text(), input.path, target, rewrite, []));
					for (const value of Object.values($(node).attr() ?? {}))
						if (/url\s*\(/i.test(value))
							patches.push(...stylesheetPatches(value, input.path, target, rewrite, []));
				}
				if (patches.length)
					throw new Error(
						'SVG dependency rewrites would change attachment bytes; explicit resource review is required',
					);
			}
			if (patches.length) {
				const before = await readFile(join(project, input.path), 'utf8');
				for (const patch of patches)
					plan.edits.push({
						source: input.path,
						kind: patch.kind,
						start: patch.start,
						end: patch.end,
						before: before.slice(patch.start, patch.end),
						after: patch.text,
					});
			}
			plan.operations.push({
				source: input.path,
				target,
				beforeSha256: input.sha256,
				afterSha256: contents === undefined ? input.sha256 : migrationHash(contents),
				mode: input.mode,
				...(contents === undefined ? {} : { contents }),
			});
		} catch (error) {
			issue(
				'source-conversion',
				input.path,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
	const visited = new Set<string>(),
		active = new Set<string>();
	const visitDependency = (source: string): void => {
		if (active.has(source)) {
			issue('dependency-cycle', source, 'Cyclic stylesheet or SVG dependency requires review');
			return;
		}
		if (visited.has(source)) return;
		active.add(source);
		for (const next of dependencies.get(source) ?? []) visitDependency(next);
		active.delete(source);
		visited.add(source);
	};
	for (const source of dependencies.keys()) visitDependency(source);
	for (const [target, value] of [
		['publishing/project.json', migrationConfig],
		['publishing/legacy-links.json', plan.legacyLinks],
	] as const) {
		if (targets.has(portablePathKey(target)))
			issue('path-collision', target, 'Move collides with generated configuration');
		const contents = migrationJson(value);
		try {
			await lstat(join(project, target));
			issue('occupied-target', target, 'Generated configuration already exists');
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
		plan.operations.push({ target, contents, mode: 0o644, afterSha256: migrationHash(contents) });
	}
	plan.issues = [...new Map(plan.issues.map((item) => [JSON.stringify(item), item])).values()];
	return plan;
}
