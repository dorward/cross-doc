import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { within } from './layout.js';
import { lookup } from 'mime-types';
import { load } from 'cheerio';
import { embedCssAssets } from './css_assets.js';
import type { AssetReference } from './types.js';

export const externalAsset = (value: string): boolean =>
	/^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(value);
// Resolve against the authoring file, never the generated document's directory.
export async function resolveAsset(
	reference: string,
	source: string,
	project: string,
	ancestors: readonly string[] = [],
): Promise<AssetReference | null> {
	if (/^file:/i.test(reference))
		throw new Error(`Local file URLs are unsupported: ${source}: ${reference}`);
	if (!reference || externalAsset(reference)) return null;
	try {
		const root = await realpath(project);
		const raw = reference.split(/[?#]/, 1)[0] ?? '';
		const pieces = raw.split('/').map((piece) => {
			const decoded = decodeURIComponent(piece);
			if (/[\\/]/.test(decoded) || decoded.includes('\0'))
				throw new Error('Invalid encoded path separator');
			return decoded;
		});
		if (raw.startsWith('/') || raw.includes('\\'))
			throw new Error('Absolute paths and backslashes are unsupported');
		const projectRoot = resolve(project);
		const author = within(projectRoot, resolve(source))
			? resolve(source)
			: within(root, resolve(source))
				? resolve(projectRoot, relative(root, resolve(source)))
				: undefined;
		if (!author) throw new Error('Asset source escapes project directory');
		const logical = resolve(dirname(author), pieces.join('/'));
		if (!within(resolve(project), logical)) throw new Error('Asset escapes project directory');
		const actual = await realpath(logical);
		if (!within(root, actual)) throw new Error('Asset symlink escapes project directory');
		if (!(await stat(actual)).isFile()) throw new Error('Asset is not a file');

		if (ancestors.includes(actual)) throw new Error(`Circular asset dependency: ${actual}`);
		let buffer = await readFile(actual);
		if (/\.svg$/i.test(actual)) {
			const $ = load(buffer.toString('utf8'), { xmlMode: true });
			let changed = false;
			for (const element of $('image, use, feImage').toArray()) {
				const node = $(element);
				for (const attribute of ['href', 'xlink:href']) {
					const value = node.attr(attribute);
					if (!value) continue;
					const dependency = await resolveAsset(value, actual, project, [...ancestors, actual]);
					if (dependency) {
						node.attr(attribute, dependency.data);
						changed = true;
					}
				}
			}
			for (const element of $('*').toArray()) {
				const node = $(element);
				for (const [attribute, value] of Object.entries(node.attr() ?? {})) {
					if (attribute === 'style' || !/url\s*\(/i.test(value)) continue;
					const embedded = await embedCssAssets(value, actual, project, undefined, [
						...ancestors,
						actual,
					]);
					if (embedded !== value) {
						node.attr(attribute, embedded);
						changed = true;
					}
				}
			}
			for (const element of $('style, [style]').toArray()) {
				const node = $(element);
				const value = node.is('style') ? node.text() : (node.attr('style') ?? '');
				const embedded = await embedCssAssets(value, actual, project, undefined, [
					...ancestors,
					actual,
				]);
				if (embedded !== value) {
					if (node.is('style')) node.text(embedded);
					else node.attr('style', embedded);
					changed = true;
				}
			}
			if (changed) buffer = Buffer.from($.xml());
		}
		const suffix = reference.slice(raw.length);
		return {
			path: actual,
			href:
				relative(resolve(project), logical).split(sep).map(encodeURIComponent).join('/') + suffix,
			data: `data:${lookup(actual) || 'application/octet-stream'};base64,${buffer.toString('base64')}${reference.includes('#') ? reference.slice(reference.indexOf('#')) : ''}`,
		};
	} catch (cause) {
		throw new Error(
			`Cannot resolve asset ${JSON.stringify(reference)} from ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
	}
}
