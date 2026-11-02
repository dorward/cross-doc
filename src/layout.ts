import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import read from './read.js';
import { projectPaths, relativeProjectPath } from './configuration.js';
export { relativeProjectPath } from './configuration.js';
import type { ProjectOptions, ResolvedProjectLayout } from './types.js';

export function within(root: string, path: string): boolean {
	const distance = relative(root, path);
	return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}
async function configuredPath(
	root: string,
	path: string,
	kind: 'file' | 'directory',
): Promise<string> {
	const actual = await realpath(resolve(root, path));
	if (!within(root, actual)) throw new Error(`Configured path escapes project: ${path}`);
	const info = await stat(actual);
	if (kind === 'file' ? !info.isFile() : !info.isDirectory())
		throw new Error(`Configured ${kind} has wrong kind: ${path}`);
	return actual;
}
export async function resolveProjectLayout(
	options: ProjectOptions,
): Promise<ResolvedProjectLayout> {
	const project = resolve(options.project);
	const configFile =
		options.configFile === undefined ? 'publishing/project.json' : options.configFile;
	relativeProjectPath(configFile, 'configFile');
	try {
		await lstat(resolve(project, configFile));
	} catch (error) {
		if (
			options.configFile === undefined &&
			error instanceof Error &&
			'code' in error &&
			error.code === 'ENOENT'
		)
			return {
				project,
				identity: 'legacy',
				paths: {
					entries: 'data',
					attachments: 'resources',
					categories: 'data/categories.json',
					layout: 'templates/index.html',
					themes: 'templates',
				},
			};
		throw error;
	}
	const root = await realpath(project);
	await configuredPath(root, configFile, 'file');
	const data: unknown = JSON.parse(await read(resolve(project, configFile)));
	const paths = projectPaths(data);
	const directories = [paths.entries, paths.attachments, paths.themes];
	const actualDirectories = [];
	for (const directory of directories)
		actualDirectories.push(await configuredPath(root, directory, 'directory'));
	if ((await lstat(resolve(project, paths.entries))).isSymbolicLink())
		throw new Error(`Entry root must not be a symlink: ${paths.entries}`);
	for (let a = 0; a < directories.length; a++)
		for (let b = a + 1; b < directories.length; b++) {
			const first = actualDirectories[a];
			const second = actualDirectories[b];
			if (first && second && (within(first, second) || within(second, first)))
				throw new Error(
					`Configured directory roots overlap: ${directories[a]} and ${directories[b]}`,
				);
		}
	const entries = actualDirectories[0];
	for (const file of [paths.categories, paths.layout, paths.legacyLinks, configFile]) {
		if (!file) continue;
		const actual = await configuredPath(root, file, 'file');
		if (entries && within(entries, actual))
			throw new Error(`Configuration/layout files must be outside entries: ${file}`);
	}
	return { project, configFile, identity: 'vault-path-v1', paths };
}
