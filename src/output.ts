import type { HtmlDocument, OutputOptions } from './types.js';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { lookup } from 'mime-types';
import write from './internal/write.js';

const localAsset = async (
	reference: string | undefined,
	project: string,
	htmlDirectory: string,
): Promise<{ data: string; href: string } | null> => {
	// Fragments, remote URLs, protocol-relative links, and existing data URLs are not files.
	if (!reference || /^(?:#|\/\/|[a-z][a-z\d+.-]*:)/i.test(reference)) return null;
	const root = await realpath(project);
	const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0] ?? '');
	// Legacy document references use ../resources and ../templates from an output directory.
	const path = resolve(root, pathname.startsWith('../') ? pathname.slice(3) : pathname);
	const inside = (candidate: string): boolean => {
		const distance = relative(root, candidate);
		return (
			distance !== '..' &&
			!distance.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
			!isAbsolute(distance)
		);
	};
	if (!inside(path)) throw new Error(`Asset escapes project directory: ${reference}`);
	const actual = await realpath(path);
	if (!inside(actual)) throw new Error(`Asset symlink escapes project directory: ${reference}`);
	const buffer = await readFile(actual);
	const suffix = reference.match(/[?#].*$/)?.[0] ?? '';
	// Validate real paths, but emit URLs against logical project/document paths.
	const urlPath = resolve(project, relative(root, path));
	const href =
		relative(htmlDirectory, urlPath).split(sep).map(encodeURIComponent).join('/') + suffix;
	return {
		data: `data:${lookup(actual) || 'application/octet-stream'};base64,${buffer.toString('base64')}`,
		href,
	};
};

export default async ($: HtmlDocument, options: OutputOptions): Promise<void> => {
	const { html_file_name, pdf_file_name, embedded_html_file_name, project } = options;
	const htmlDirectory = dirname(resolve(html_file_name));
	const assets = [];
	for (const element of $('img[src], [href]').toArray()) {
		const node = $(element);
		const attribute = node.is('img[src]') ? 'src' : 'href';
		const asset = await localAsset(node.attr(attribute), project, htmlDirectory);
		if (asset) assets.push({ node, attribute, ...asset });
	}
	// Source resource conventions are project-relative; emitted URLs must instead
	// be relative to the actual HTML location, which Prince uses as its base.
	for (const { node, attribute, href } of assets) node.attr(attribute, href);
	await write(html_file_name, $.root().html() ?? '');
	// Preserve directory creation for independently located PDF output.
	await mkdir(dirname(resolve(pdf_file_name)), { recursive: true });
	await new Promise<void>((resolveResult, reject) => {
		execFile(
			options.prince_binary || 'prince',
			['--no-network', resolve(html_file_name), '-o', resolve(pdf_file_name)],
			{
				timeout: 30000,
				maxBuffer: 31457280,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					Object.assign(error, { stdout, stderr });
					reject(error);
				} else resolveResult(undefined);
			},
		);
	});
	for (const { node, attribute, data } of assets) node.attr(attribute, data);
	await write(embedded_html_file_name, $.root().html() ?? '');
};
