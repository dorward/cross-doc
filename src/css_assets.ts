import { fileURLToPath } from 'node:url';
import { resolveAsset, externalAsset } from './assets.js';
import type { CssSourceMap, CssUrl } from './types.js';

const decodeCss = (text: string): string =>
	text.replace(
		/\\(?:([\da-f]{1,6})[ \t\r\n\f]?|\r\n|[\n\r\f]|(.))/gi,
		(_match, hex: string | undefined, character: string | undefined) =>
			hex
				? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd)
				: (character ?? ''),
	);

// Scan CSS syntax, skipping comments and unrelated strings. Sass has already expanded
// variables and imports; URL locations are mapped back to their originating partial.
function urls(css: string): CssUrl[] {
	const result: CssUrl[] = [];
	let i = 0;
	const stringEnd = (start: number): number => {
		const quote = css[start];
		let end = start + 1;
		while (end < css.length) {
			if (css[end] === '\\') end += 2;
			else if (css[end++] === quote) return end;
		}
		throw new Error('Unterminated CSS string');
	};
	while (i < css.length) {
		if (css.startsWith('/*', i)) {
			const end = css.indexOf('*/', i + 2);
			if (end < 0) throw new Error('Unterminated CSS comment');
			i = end + 2;
			continue;
		}
		const match = /^(?:url\s*\(|@import\s+(?=["']))/i.exec(css.slice(i));
		if (match && (i === 0 || !/[\w-]/.test(css[i - 1] ?? ''))) {
			const start = i;
			i += match[0].length;
			while (/\s/.test(css[i] ?? '') && i < css.length) i++;
			let value: string;
			if (css[i] === '"' || css[i] === "'") {
				const end = stringEnd(i);
				value = decodeCss(css.slice(i + 1, end - 1));
				i = end;
			} else {
				const begin = i;
				while (i < css.length && css[i] !== ')') {
					if (css[i] === '\\') i++;
					i++;
				}
				value = decodeCss(css.slice(begin, i).trim());
			}
			if (match[0].toLowerCase().startsWith('url')) {
				while (/\s/.test(css[i] ?? '') && i < css.length) i++;
				if (css[i++] !== ')') throw new Error('Invalid CSS url()');
				result.push({ start, end: i, value });
			} else {
				// Keep @import's grammar while replacing its quoted destination.
				const destinationStart = start + match[0].length;
				result.push({ start: destinationStart, end: i, value });
			}
			continue;
		}
		if (css[i] === '"' || css[i] === "'") i = stringEnd(i);
		else i++;
	}
	return result;
}

function sourceAt(css: string, offset: number, map: CssSourceMap, fallback: string): string {
	const prefix = css.slice(0, offset).split('\n');
	const line = prefix.length - 1;
	const column = prefix.at(-1)?.length ?? 0;
	let source = 0;
	let selected: number | undefined;
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	for (const [row, mappings] of map.mappings.split(';').entries()) {
		if (row > line) break;
		let generated = 0;
		for (const segment of mappings.split(',')) {
			const values: number[] = [];
			let value = 0,
				shift = 0;
			for (const char of segment) {
				const digit = alphabet.indexOf(char);
				if (digit < 0) throw new Error('Invalid Sass source map');
				value += (digit & 31) * 2 ** shift;
				if (digit & 32) shift += 5;
				else {
					values.push(value & 1 ? -(value >> 1) : value >> 1);
					value = 0;
					shift = 0;
				}
			}
			generated += values[0] ?? 0;
			if (values.length >= 4) {
				source += values[1] ?? 0;
				if (row === line && generated <= column) selected = source;
			}
		}
	}
	if (selected === undefined) return fallback;
	const origin = map.sources[selected];
	if (!origin?.startsWith('file:')) throw new Error('CSS asset has no filesystem source');
	return fileURLToPath(origin);
}

export async function embedCssAssets(
	css: string,
	source: string,
	project: string,
	map?: CssSourceMap,
	ancestors: readonly string[] = [],
): Promise<string> {
	const tokens = urls(css);
	let result = css;
	for (const token of tokens.reverse()) {
		if (externalAsset(token.value) && !/^file:/i.test(token.value)) continue;
		const origin = map ? sourceAt(css, token.start, map, source) : source;
		const asset = await resolveAsset(token.value, origin, project, ancestors);
		if (!asset) continue;
		if (ancestors.includes(asset.path)) throw new Error(`Circular CSS import: ${asset.path}`);
		let data = asset.data;
		if (/\.css(?:[?#]|$)/i.test(token.value)) {
			const { readFile } = await import('node:fs/promises');
			const nested = await embedCssAssets(
				await readFile(asset.path, 'utf8'),
				asset.path,
				project,
				undefined,
				[...ancestors, asset.path],
			);
			data = `data:text/css;base64,${Buffer.from(nested).toString('base64')}`;
		}
		const replacement =
			css.slice(token.start, token.start + 3).toLowerCase() === 'url'
				? `url("${data}")`
				: `"${data}"`;
		result = result.slice(0, token.start) + replacement + result.slice(token.end);
	}
	return result;
}
