import { isMap, isScalar, parseDocument, visit } from 'yaml';
import { load } from 'cheerio';
import { headingMarkdown, markdown } from './markdown.js';
import { escapeHtml } from './internal/html.js';
import { rewriteHtml } from './migration_templates.js';
import type {
	MigrationHeader,
	MigrationPatch,
	MigrationProjection,
	MigrationRewrite,
	MigrationToken,
} from './types.js';

export { applyPatches } from './internal/migration_edits.js';

export function migrationHeader(text: string): MigrationHeader {
	const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(text);
	if (!opening) throw new Error('Missing YAML frontmatter');
	const rest = text.slice(opening[0].length);
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
	if (!closing) throw new Error('Unterminated YAML frontmatter');
	const yaml = rest.slice(0, closing.index);
	const doc = parseDocument(yaml, {
		keepSourceTokens: true,
		customTags: ['timestamp'],
		uniqueKeys: true,
	});
	if (doc.errors.length) throw new Error(doc.errors.map((error) => error.message).join('; '));
	if (!isMap(doc.contents)) throw new Error('Frontmatter must be a map');
	const header: MigrationHeader = {
		bodyStart: opening[0].length + closing.index + closing[0].length,
		figures: [],
	};
	const pairs = doc.contents.items;
	const pair = pairs.find((item) => isScalar(item.key) && item.key.value === 'figures');
	if (!pair) return header;
	if (doc.contents.flow)
		throw new Error('Flow-style figures frontmatter requires manual source-range review');
	if (!isScalar(pair.key) || !pair.key.range) throw new Error('Cannot locate figures key');
	let ambiguous = false;
	for (const value of [pair.key, pair.value])
		visit(value, (_key, node) => {
			if (
				node &&
				typeof node === 'object' &&
				('comment' in node || 'commentBefore' in node || 'anchor' in node)
			) {
				if (
					('comment' in node && node.comment) ||
					('commentBefore' in node && node.commentBefore) ||
					('anchor' in node && node.anchor)
				)
					ambiguous = true;
			}
		});
	if (pairs.at(-1) === pair && doc.comment) ambiguous = true;
	if (ambiguous) throw new Error('Figures comments or anchors require explicit ownership review');
	const value = pair.value;
	const metadata = doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
	const figures = metadata.figures;
	if (figures !== null && !Array.isArray(figures))
		throw new Error('Figures must be an array or null');
	for (const item of (figures ?? []) as unknown[]) {
		if (
			!item ||
			typeof item !== 'object' ||
			!('file' in item) ||
			!('caption' in item) ||
			typeof item.file !== 'string' ||
			typeof item.caption !== 'string' ||
			!item.caption.length
		)
			throw new Error('Malformed or empty figure caption');
		if (Object.keys(item).some((key) => key !== 'file' && key !== 'caption'))
			throw new Error('Unknown figure fields require manual preservation review');
		header.figures.push({ file: item.file, caption: item.caption });
	}
	const start = pair.key.range[0];
	if (yaml.slice(yaml.lastIndexOf('\n', start - 1) + 1, start).trim())
		throw new Error('Figures key does not begin its own line');
	const end =
		value && typeof value === 'object' && 'range' in value && Array.isArray(value.range)
			? Number(value.range[2])
			: (() => {
					const newline = yaml.indexOf('\n', start);
					return newline === -1 ? yaml.length : newline + 1;
				})();
	const from = yaml.lastIndexOf('\n', start - 1) + 1;
	if (!Number.isInteger(end) || end < start) throw new Error('Cannot locate full figures value');
	const remaining = yaml.slice(0, from) + yaml.slice(end);
	const after = parseDocument(remaining, { customTags: ['timestamp'], uniqueKeys: true });
	if (after.errors.length) throw new Error('Figures removal would break YAML');
	delete metadata.figures;
	if (JSON.stringify(after.toJS({ maxAliasCount: 50 })) !== JSON.stringify(metadata))
		throw new Error('Figures removal changes other YAML values');
	header.figuresRange = [opening[0].length + from, opening[0].length + end];
	return header;
}

export function figureMarkdown(url: string, caption: string, eol: string): string {
	const alt = escapeHtml(caption)
		.replace(/([\\[\]`*_{}()!|])/g, '\\$1')
		.replace(/--/g, '&#45;&#45;')
		.replace(/\.\.\./g, '&#46;&#46;&#46;');
	const title = escapeHtml(caption).replace(/\\/g, '\\\\');
	const result = `![${alt}](<${url}> "${title}")`.replace(/\n/g, eol);
	const $ = load(markdown.parse(result, { async: false }));
	if (
		$('p > img').length !== 1 ||
		$('img').attr('title') !== caption ||
		$('img').attr('alt') !== caption
	)
		throw new Error('Figure caption cannot round-trip losslessly as a Markdown image');
	return result;
}

// Marked removes container prefixes and normalizes CRLF. Project those transformations
// while retaining original UTF-16 offsets; patches always target original source bytes.
function project(text: string, offsets?: readonly number[]): MigrationProjection {
	const result: MigrationProjection = { text: '', offsets: [] };
	let cursor = 0;
	for (const line of text.split(/(?<=\n)/)) {
		const prefix =
			/^[ \t]*(?:(?:>[ \t]?|[-+*][ \t]+|\d+[.)][ \t]+)[ \t]*)*/.exec(line)?.[0].length ?? 0;
		for (let i = prefix; i < line.length; i++) {
			if (line[i] === '\r' && line[i + 1] === '\n') continue;
			result.text += line[i];
			result.offsets.push(offsets?.[cursor + i] ?? cursor + i);
		}
		cursor += line.length;
	}
	return result;
}

function closingBracket(raw: string, start: number): number {
	let depth = 0;
	for (let i = start; i < raw.length; i++) {
		if (raw[i] === '\\') {
			i++;
			continue;
		}
		if (raw[i] === '`') {
			const run = /^`+/.exec(raw.slice(i))?.[0] ?? '`';
			const end = raw.indexOf(run, i + run.length);
			if (end !== -1) {
				i = end + run.length - 1;
				continue;
			}
		}
		if (raw[i] === '[') depth++;
		if (raw[i] === ']' && --depth === 0) return i;
	}
	return -1;
}
function destinationSpan(token: MigrationToken): [number, number] | undefined {
	const raw = token.raw;
	const close = closingBracket(raw, raw.startsWith('!') ? 1 : 0);
	if (close < 0) return undefined;
	let start = close + 1;
	if (raw[start++] !== '(') return undefined;
	while (/\s/.test(raw[start] ?? '') && start < raw.length) start++;
	if (raw[start] === '<') {
		const begin = ++start;
		while (start < raw.length) {
			if (raw[start] === '\\') start++;
			else if (raw[start] === '>') return [begin, start];
			start++;
		}
		throw new Error('Unterminated angle destination');
	}
	const begin = start;
	let depth = 0;
	while (start < raw.length) {
		const char = raw[start];
		if (char === '\\') {
			start += 2;
			continue;
		}
		if (char === '(') depth++;
		if (char === ')') {
			if (depth === 0) break;
			depth--;
		}
		if (/\s/.test(char ?? '')) break;
		start++;
	}
	return [begin, start];
}

export function markdownPatches(
	body: string,
	source: string,
	target: string,
	rewrite: MigrationRewrite,
): MigrationPatch[] {
	const patches: MigrationPatch[] = [];
	const usedReferences = new Set<string>();
	const definitions = new Map<string, MigrationPatch[]>();
	const referenceLabel = (label: string): string => label.replace(/\s+/g, ' ').trim().toLowerCase();
	const walk = (tokens: readonly MigrationToken[], region: MigrationProjection): void => {
		let cursor = 0;
		for (const token of tokens) {
			const local = project(token.raw);
			if (!local.text) continue;
			const found = region.text.indexOf(local.text, cursor);
			if (found < 0) throw new Error(`Cannot locate ${token.type} token safely in original source`);
			cursor = found + local.text.length;
			const mapped = { text: local.text, offsets: region.offsets.slice(found, cursor) };
			if (token.type === 'def' && token.tag !== undefined) {
				const label = referenceLabel(token.tag);
				const edits = definitions.get(label) ?? [];
				edits.push({
					start: mapped.offsets[0]!,
					end: mapped.offsets.at(-1)! + 1,
					text: '',
					kind: 'remove-expanded-reference-definition',
				});
				definitions.set(label, edits);
			}
			if (token.type === 'code' || token.type === 'codespan') continue;
			if (token.type === 'crossDocWiki')
				throw new Error('Existing Wikilinks require an explicit migration decision');
			if (token.type === 'html') {
				const htmlPatches = rewriteHtml(token.raw, source, target, rewrite, false);
				for (const patch of htmlPatches) {
					const a = local.offsets.indexOf(patch.start),
						b = local.offsets.indexOf(patch.end - 1);
					if (a < 0 || b < 0) throw new Error('Cannot locate HTML attribute in original Markdown');
					patches.push({ ...patch, start: mapped.offsets[a]!, end: mapped.offsets[b]! + 1 });
				}
			}
			if ((token.type === 'link' || token.type === 'image') && token.href !== undefined) {
				const span = destinationSpan(token);
				const close = closingBracket(token.raw, token.type === 'image' ? 1 : 0);
				// Obsidian Live Preview needs labels on one source line. Collapse only
				// parser-confirmed labels, using original offsets across CRLF/containers.
				const labelEnd = local.offsets.indexOf(close);
				if (labelEnd >= 0) {
					for (const newline of local.text.slice(0, labelEnd).matchAll(/[ \t]*\n[ \t]*/g)) {
						let start = mapped.offsets[newline.index]!;
						if (body[start - 1] === '\r') start--;
						patches.push({
							start,
							end: mapped.offsets[newline.index + newline[0].length]!,
							text: ' ',
							kind: 'single-line-link-label',
						});
					}
				}
				if (!span && close >= 0 && (token.type === 'link' || token.type === 'image')) {
					const suffix = token.raw.slice(close + 1);
					const label =
						suffix.startsWith('[') && suffix !== '[]'
							? suffix.slice(1, -1)
							: token.raw.slice(token.type === 'image' ? 2 : 1, close);
					usedReferences.add(referenceLabel(label));
					const href = rewrite(
						token.href,
						token.type === 'image' ? 'image' : 'link',
						source,
						target,
					);
					const destination = href.replace(/([\\<>])/g, '\\$1');
					const title =
						token.title == null
							? ''
							: ` "${token.title.replace(/([\\"])/g, '\\$1').replace(/\n/g, body.includes('\r\n') ? '\r\n' : '\n')}"`;
					const a = local.offsets.indexOf(close);
					if (a < 0) throw new Error('Cannot locate reference label in original Markdown');
					patches.push({
						start: mapped.offsets[a]! + 1,
						end: mapped.offsets.at(-1)! + 1,
						text: `(<${destination}>${title})`,
						kind: 'expand-reference-link',
					});
				}
				if (span) {
					const text = rewrite(
						token.href,
						token.type === 'image' ? 'image' : 'link',
						source,
						target,
					);
					if (text !== token.href) {
						const a = local.offsets.indexOf(span[0]),
							b = local.offsets.indexOf(span[1] - 1);
						if (a < 0 || b < 0)
							throw new Error('Cannot locate link destination in original Markdown');
						patches.push({
							start: mapped.offsets[a]!,
							end: mapped.offsets[b]! + 1,
							text,
							kind: 'markdown-destination',
						});
					}
				}
			}
			if (token.tokens) walk(token.tokens, mapped);
			else if (token.items) walk(token.items, mapped);
			else if (token.header && token.rows) {
				const cellTokens = [...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens);
				walk(cellTokens, mapped);
			}
		}
	};
	walk(headingMarkdown.lexer(body) as unknown as MigrationToken[], project(body));
	const removals = [...usedReferences].flatMap((label) => definitions.get(label) ?? []);
	// Nested image/link labels can identify the same line break.
	return [
		...new Map(
			[...patches, ...removals].map((patch) => [
				`${patch.start}:${patch.end}:${patch.text}`,
				patch,
			]),
		).values(),
	];
}
