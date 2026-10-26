import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { within } from './layout.js';
import { portablePathKey } from './project_index.js';
import { record, safeKeys } from './internal/validate.js';
import type {
	PublicationDestination,
	PublicationOptions,
	ResolvedPublicationDestination,
	ResolvedProjectLayout,
} from './types.js';

function keys(
	value: unknown,
	allowed: readonly string[],
	label: string,
): asserts value is Record<string, unknown> {
	record(value, label);
	if (Object.keys(value).some((key) => !allowed.includes(key)))
		throw new Error(`Unknown ${label} option`);
}
const pathOption = (value: unknown, label: string): void => {
	if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
		throw new Error(`Invalid ${label} path`);
};
export function validatePublication(options: PublicationOptions): void {
	safeKeys(options);
	keys(
		options,
		['project', 'configFile', 'theme', 'include', 'outputs', 'intermediates', 'overwrite'],
		'publication',
	);
	pathOption(options.project, 'project');
	if (typeof options.theme !== 'string' || !options.theme)
		throw new Error('Missing publication theme');
	if (options.overwrite !== undefined && typeof options.overwrite !== 'boolean')
		throw new Error('Invalid overwrite option');
	keys(options.outputs, ['html', 'pdf'], 'outputs');
	if (!options.outputs.html && !options.outputs.pdf)
		throw new Error('At least one publication output is required');
	const html = options.outputs.html;
	if (html !== undefined) {
		keys(html, ['path', 'format', 'assetsDirectory'], 'HTML');
		pathOption(html.path, 'HTML');
		if (html.format !== undefined && html.format !== 'embedded' && html.format !== 'linked')
			throw new Error('Invalid HTML format');
		if (html.assetsDirectory !== undefined) {
			if (html.format !== 'linked') throw new Error('assetsDirectory requires linked HTML');
			pathOption(html.assetsDirectory, 'assetsDirectory');
		}
	}
	const pdf = options.outputs.pdf;
	if (pdf !== undefined) {
		keys(pdf, ['path', 'princeBinary'], 'PDF');
		pathOption(pdf.path, 'PDF');
		if (pdf.princeBinary !== undefined) pathOption(pdf.princeBinary, 'Prince');
	}
	if (options.intermediates !== undefined) {
		const value = options.intermediates;
		keys(value, ['directory', 'cssFile', 'htmlFile', 'keep'], 'intermediates');
		for (const key of ['directory', 'cssFile', 'htmlFile'] as const)
			if (value[key] !== undefined) pathOption(value[key], key);
		if (value.keep !== undefined && typeof value.keep !== 'boolean')
			throw new Error('Invalid intermediate keep option');
	}
}
export const missingPath = (error: unknown): boolean =>
	error instanceof Error && 'code' in error && error.code === 'ENOENT';

// Resolve existing ancestors too: destinations may not have been created yet.
export async function canonicalDestination(path: string): Promise<string> {
	const absolute = resolve(path);
	try {
		await lstat(absolute); // A dangling symlink must fail rather than be treated as a missing leaf.
	} catch (error) {
		if (!missingPath(error)) throw error;
		const parent = dirname(absolute);
		if (parent === absolute) throw error;
		return join(await canonicalDestination(parent), basename(absolute));
	}
	return realpath(absolute);
}
export async function protectDestinations(
	layout: ResolvedProjectLayout,
	destinations: readonly PublicationDestination[],
	overwrite: boolean,
): Promise<void> {
	const root = await realpath(layout.project);
	const roots = [
		layout.paths.entries,
		layout.paths.attachments,
		layout.paths.themes,
		dirname(layout.paths.layout),
		dirname(layout.paths.categories),
		...[layout.configFile, layout.paths.legacyLinks]
			.filter((value): value is string => !!value)
			.map(dirname),
		'.git',
		'.obsidian',
		'artwork',
		'drafts',
		'cover',
		'misc',
		'TODO',
	];
	// A root-level configuration protects its file, not the entire project.
	const protectedPaths = await Promise.all(
		roots
			.filter((path) => path !== '.')
			.map((path) => canonicalDestination(resolve(layout.project, path))),
	);
	const sourceFiles = [
		layout.paths.layout,
		layout.paths.categories,
		layout.configFile,
		layout.paths.legacyLinks,
	].filter((value): value is string => !!value);
	protectedPaths.push(
		...(await Promise.all(
			sourceFiles.map((path) => canonicalDestination(resolve(layout.project, path))),
		)),
	);
	const resolved: ResolvedPublicationDestination[] = [];
	for (const destination of destinations) {
		const path = await canonicalDestination(destination.path);
		const portable = portablePathKey(path);
		if (
			protectedPaths.some(
				(source) =>
					within(portablePathKey(source), portable) ||
					(destination.directory && within(portable, portablePathKey(source))),
			)
		)
			throw new Error(`Output overlaps project sources: ${destination.path}`);
		if (path === root || dirname(path) === root)
			throw new Error(
				`Outputs inside the project require a dedicated export directory: ${destination.path}`,
			);
		for (const prior of resolved) {
			const before = portablePathKey(prior.path);
			if (within(before, portable) || within(portable, before))
				throw new Error(
					`Publication paths overlap: ${prior.destination.path} and ${destination.path}`,
				);
		}
		try {
			const info = await lstat(destination.path);
			if (info.isSymbolicLink())
				throw new Error(`Output destination must not be a symlink: ${destination.path}`);
			if (destination.intermediate || !overwrite)
				throw new Error(`Output already exists: ${destination.path}`);
			if (destination.directory ? !info.isDirectory() : !info.isFile())
				throw new Error(`Invalid output file kind: ${destination.path}`);
			if (!destination.directory && (await stat(destination.path)).nlink > 1)
				throw new Error(`Hard-linked output is unsupported: ${destination.path}`);
		} catch (error) {
			if (!missingPath(error)) throw error;
		}
		resolved.push({ destination, path });
	}
}
