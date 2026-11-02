import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extension } from 'mime-types';
import { load } from 'cheerio';
import { resolveAsset } from './assets.js';
import { missingPath } from './publication_paths.js';
import type { HtmlDocument, PortableAsset, ResolvedProjectLayout } from './types.js';

function unpack(data: string): PortableAsset {
	const match = /^data:([^,]*),(.*?)(#.*)?$/s.exec(data);
	if (!match) throw new Error('Invalid portable asset data');
	const metadata = match[1] ?? '';
	return {
		mime: metadata.split(';')[0] || 'application/octet-stream',
		data: /;base64$/i.test(metadata)
			? Buffer.from(match[2] ?? '', 'base64')
			: Buffer.from(decodeURIComponent(match[2] ?? '')),
		suffix: match[3] ?? '',
	};
}

async function copyAsset(
	data: string,
	directory: string,
	htmlPath: string,
	resourceSuffix?: string,
): Promise<string> {
	const asset = unpack(data);
	const suffix = extension(asset.mime) || 'bin';
	const filename = `${createHash('sha256').update(asset.mime).update(asset.data).digest('hex')}.${suffix}`;
	const path = join(directory, filename);
	// Never follow an existing companion-file symlink or truncate another file.
	try {
		await writeFile(path, asset.data, { flag: 'wx' });
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
		const info = await lstat(path);
		if (!info.isFile() || info.nlink !== 1 || !(await readFile(path)).equals(asset.data))
			throw new Error(`Unsafe existing companion asset: ${path}`);
	}
	return (
		relative(dirname(htmlPath), path).split(sep).map(encodeURIComponent).join('/') +
		(resourceSuffix ?? asset.suffix)
	);
}

/** Clone the rendered document; PDF and HTML can use different destinations/formats. */
export async function portableDocument(
	document: HtmlDocument,
	layout: ResolvedProjectLayout,
	cssFile: string,
	htmlPath: string,
	assetsDirectory?: string,
): Promise<string> {
	const $ = load(document.html());
	if (assetsDirectory) await mkdir(assetsDirectory, { recursive: true });
	for (const element of $('img[src], link[href], a[href]').toArray()) {
		const node = $(element);
		if (node.closest('pre,code,svg,math').length) continue;
		const attribute = node.is('img') ? 'src' : 'href';
		const reference = node.attr(attribute) ?? '';
		let data: string | undefined;
		let resourceSuffix: string | undefined;
		if (reference === pathToFileURL(cssFile).href)
			data = `data:text/css;base64,${(await readFile(cssFile)).toString('base64')}`;
		else if (reference.startsWith('data:')) data = reference;
		else {
			const asset = await resolveAsset(reference, resolve(layout.project, '_'), layout.project);
			data = asset?.data;
			resourceSuffix = asset?.href.match(/[?#].*$/)?.[0];
		}
		if (data)
			node.attr(
				attribute,
				assetsDirectory ? await copyAsset(data, assetsDirectory, htmlPath, resourceSuffix) : data,
			);
	}
	return $.html();
}

export async function writePublication(
	path: string,
	contents: string,
	overwrite: boolean,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	// Recheck immediately before writing. Path protection also validated every existing ancestor.
	try {
		const info = await lstat(path);
		if (!overwrite) throw new Error(`Output already exists: ${path}`);
		if (!info.isFile() || info.nlink > 1) throw new Error(`Unsafe output destination: ${path}`);
	} catch (error) {
		if (!missingPath(error)) throw error;
	}
	await writeFile(path, contents, {
		flag:
			constants.O_WRONLY |
			constants.O_CREAT |
			(overwrite ? constants.O_TRUNC : constants.O_EXCL) |
			(constants.O_NOFOLLOW ?? 0),
	});
}
