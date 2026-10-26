import { readdir } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import klaw from 'klaw';
import { relativeProjectPath, resolveProjectLayout } from './layout.js';
import { record, safeKeys } from './internal/validate.js';
import read from './read.js';
import parseData from './parse_data.js';
import type { LegacyLinks, ProjectIndex, ProjectOptions, ResolvedProjectLayout } from './types.js';

export const portablePathKey = (path: string): string =>
	path.normalize('NFC').toUpperCase().normalize('NFC');

export const encodeIdentity = (identity: string): string =>
	identity.split('/').map(encodeURIComponent).join('/');
export const idHref = (id: string): string => `#${encodeIdentity(id)}`;
export const entryId = (identity: string): string => `entry/${encodeIdentity(identity)}`;
export const figureId = (identity: string, ordinal: number): string =>
	`figure/${encodeIdentity(identity)}/${ordinal}`;
export const canonicalReference = (value: string, index: ProjectIndex): string =>
	index.legacyLinks.entries.find((entry) => entry.legacySlug === value)?.target ?? value;

export async function discoverFiles(layout: ResolvedProjectLayout): Promise<string[]> {
	const root = resolve(layout.project, layout.paths.entries);
	if (layout.identity === 'legacy')
		return new Promise((success, reject) => {
			const paths: string[] = [];
			klaw(root)
				.on('data', (item) => {
					if (item.stats.isFile() && item.path.endsWith('.md')) paths.push(item.path);
				})
				.on('error', reject)
				.on('end', () => success(paths));
		});
	const paths: string[] = [];
	const walk = async (directory: string): Promise<void> => {
		const children = await readdir(directory, { withFileTypes: true });
		children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const child of children) {
			if (child.isDirectory() && child.name.startsWith('.')) continue;
			const path = resolve(directory, child.name);
			if (child.isSymbolicLink()) throw new Error(`Entry symlinks are unsupported: ${path}`);
			if (child.isDirectory()) await walk(path);
			else if (child.isFile() && child.name.endsWith('.md')) paths.push(path);
		}
	};
	await walk(root);
	return paths;
}
function mappingRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
): asserts value is Record<string, unknown> {
	record(value, label);
	if (
		keys.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error(`Invalid ${label}: expected ${keys.join(', ')}`);
}
async function mappings(layout: ResolvedProjectLayout): Promise<LegacyLinks> {
	if (layout.identity === 'legacy') return { version: 1, entries: [], figures: [] };
	const file = layout.paths.legacyLinks;
	if (!file) throw new Error('Missing legacyLinks configuration');
	const data: unknown = JSON.parse(await read(resolve(layout.project, file)));
	safeKeys(data);
	mappingRecord(data, ['version', 'entries', 'figures'], file);
	if (data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.figures))
		throw new Error(`Invalid legacy mapping: ${file}`);
	return {
		version: 1,
		entries: data.entries.map((entry: unknown) => {
			mappingRecord(entry, ['legacySlug', 'target'], 'legacy entry');
			if (
				typeof entry.legacySlug !== 'string' ||
				!entry.legacySlug.length ||
				/[/#\\]/.test(entry.legacySlug) ||
				Array.from(entry.legacySlug).some((character) => character.charCodeAt(0) <= 32)
			)
				throw new Error('Invalid legacySlug');
			relativeProjectPath(entry.target, 'Legacy entry target');
			return { legacySlug: entry.legacySlug, target: entry.target };
		}),
		figures: data.figures.map((entry: unknown) => {
			mappingRecord(entry, ['legacyId', 'target', 'ordinal'], 'legacy figure');
			if (
				typeof entry.legacyId !== 'string' ||
				!/^figure-[^#\\]+$/.test(entry.legacyId) ||
				Array.from(entry.legacyId).some((character) => character.charCodeAt(0) <= 32)
			)
				throw new Error('Invalid legacy figure ID');
			relativeProjectPath(entry.target, 'Legacy figure target');
			if (
				typeof entry.ordinal !== 'number' ||
				!Number.isSafeInteger(entry.ordinal) ||
				entry.ordinal < 1
			)
				throw new Error('Invalid legacy figure ordinal');
			return { legacyId: entry.legacyId, target: entry.target, ordinal: entry.ordinal };
		}),
	};
}
export async function indexWithLayout(
	layout: ResolvedProjectLayout,
	paths?: readonly string[],
): Promise<ProjectIndex> {
	const entries = (paths ?? (await discoverFiles(layout))).map((path) => {
		const vaultPath = relative(layout.project, path).split(sep).join('/');
		const identity = layout.identity === 'legacy' ? basename(path, '.md') : vaultPath.slice(0, -3);
		if (layout.identity !== 'legacy') relativeProjectPath(vaultPath, 'Entry path');
		return {
			path,
			vaultPath,
			identity,
			id: layout.identity === 'legacy' ? identity : entryId(identity),
		};
	});
	const identities = new Set<string>();
	const portable = new Map<string, string>();
	for (const entry of entries) {
		if (identities.has(entry.identity))
			throw new Error(
				`Duplicate ${layout.identity === 'legacy' ? 'slug' : 'canonical identity'}: ${entry.identity}`,
			);
		identities.add(entry.identity);
		if (layout.identity !== 'legacy') {
			// Conservative Unicode caseless key: also catches expansions such as ß -> SS.
			const key = portablePathKey(entry.vaultPath);
			const previous = portable.get(key);
			if (previous) throw new Error(`Portable path collision: ${previous} and ${entry.vaultPath}`);
			portable.set(key, entry.vaultPath);
		}
	}
	const legacyLinks = await mappings(layout);
	const aliases = new Set<string>();
	for (const entry of legacyLinks.entries) {
		if (aliases.has(entry.legacySlug)) throw new Error(`Duplicate legacySlug: ${entry.legacySlug}`);
		aliases.add(entry.legacySlug);
		if (!identities.has(entry.target))
			throw new Error(`Stale legacy entry target: ${entry.target}`);
		if (identities.has(entry.legacySlug) && entry.legacySlug !== entry.target)
			throw new Error(`Legacy/canonical identity collision: ${entry.legacySlug}`);
	}
	const figures = new Set<string>();
	const counts = new Map<string, number>();
	for (const figure of legacyLinks.figures) {
		if (figures.has(figure.legacyId)) throw new Error(`Duplicate legacyId: ${figure.legacyId}`);
		figures.add(figure.legacyId);
		const owner = entries.find((entry) => entry.identity === figure.target);
		if (!owner) throw new Error(`Stale legacy figure target: ${figure.target}`);
		if (!counts.has(owner.identity)) {
			const [parsed] = parseData([{ path: owner.path, contents: await read(owner.path) }]);
			counts.set(owner.identity, parsed?.figures?.length ?? 0);
		}
		if (figure.ordinal > (counts.get(owner.identity) ?? 0))
			throw new Error(`Invalid legacy figure ordinal for ${figure.target}: ${figure.ordinal}`);
	}
	return { layout, entries, legacyLinks };
}
export async function indexProject(options: ProjectOptions): Promise<ProjectIndex> {
	return indexWithLayout(await resolveProjectLayout(options));
}
