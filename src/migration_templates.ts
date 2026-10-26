import { load } from 'cheerio';
import { cssUrls, decodeCss } from './css_assets.js';
import { escapeHtml } from './internal/html.js';
import { applyPatches } from './internal/migration_edits.js';
import type { MigrationPatch, MigrationRewrite, MigrationSourceLocation } from './types.js';

export function rewriteHtml(
	text: string,
	source: string,
	target: string,
	rewrite: MigrationRewrite,
	comments: boolean,
): MigrationPatch[] {
	const $ = load(text, { sourceCodeLocationInfo: true });
	const patches: MigrationPatch[] = [];
	for (const element of $('*')
		.filter((_i, node) =>
			['href', 'src', 'xlink:href'].some((attribute) => $(node).attr(attribute) !== undefined),
		)
		.toArray()) {
		if ($(element).closest('pre,code,script,style').length) continue;
		const location = (element as unknown as MigrationSourceLocation).sourceCodeLocation;
		for (const attribute of ['href', 'src', 'xlink:href']) {
			const reference = $(element).attr(attribute);
			if (reference === undefined) continue;
			const textReplacement = rewrite(
				reference,
				attribute === 'href' && $(element).is('a') ? 'link' : 'asset',
				source,
				target,
			);
			if (textReplacement === reference) continue;
			const range = location?.attrs?.[attribute];
			if (!range) throw new Error('HTML attribute source location is unavailable');
			const raw = text.slice(range.startOffset, range.endOffset);
			const match = /^[^=]+=[ \t\r\n]*(?:"([\s\S]*)"|'([\s\S]*)'|([^\s>]+))$/.exec(raw);
			if (!match) throw new Error('Cannot preserve HTML attribute quoting');
			const value = match[1] ?? match[2] ?? match[3] ?? '';
			const offset = raw.indexOf('=') + 1;
			const valueStart =
				range.startOffset +
				offset +
				(raw.slice(offset).match(/^[ \t\r\n]*/)?.[0].length ?? 0) +
				(match[3] === undefined ? 1 : 0);
			patches.push({
				start: valueStart,
				end: valueStart + value.length,
				text: escapeHtml(textReplacement),
				kind: 'html-destination',
			});
		}
	}
	for (const element of $('style, [style]').toArray()) {
		const node = $(element);
		if (node.closest('pre,code,script').length) continue;
		const location = (element as unknown as MigrationSourceLocation).sourceCodeLocation;
		if (node.is('style')) {
			const start = location?.startTag?.endOffset,
				end = location?.endTag?.startOffset;
			if (start === undefined || end === undefined)
				throw new Error('Cannot locate complete style block');
			const css = text.slice(start, end);
			for (const patch of stylesheetPatches(css, source, target, rewrite, []))
				patches.push({
					...patch,
					start: start + patch.start,
					end: start + patch.end,
					kind: 'html-style-resource',
				});
		}
		const css = node.attr('style');
		if (css === undefined) continue;
		const updated = applyPatches(css, stylesheetPatches(css, source, target, rewrite, []));
		if (updated === css) continue;
		const range = location?.attrs?.style;
		if (!range) throw new Error('Cannot locate style attribute');
		const raw = text.slice(range.startOffset, range.endOffset);
		const match = /^[^=]+=[ \t\r\n]*(?:"([\s\S]*)"|'([\s\S]*)'|([^\s>]+))$/.exec(raw);
		if (!match) throw new Error('Cannot preserve style attribute quoting');
		const value = match[1] ?? match[2] ?? match[3] ?? '';
		const offset = raw.indexOf('=') + 1;
		const start =
			range.startOffset +
			offset +
			(raw.slice(offset).match(/^[ \t\r\n]*/)?.[0].length ?? 0) +
			(match[3] === undefined ? 1 : 0);
		patches.push({
			start,
			end: start + value.length,
			text: escapeHtml(updated),
			kind: 'html-style-resource',
		});
	}
	if (comments) {
		for (const node of $.root().find('*').contents().toArray()) {
			if (node.type !== 'comment' || $(node).parent().closest('pre,code,script,style').length)
				continue;
			const location = (node as unknown as MigrationSourceLocation).sourceCodeLocation;
			if (!location) continue;
			const inner = rewriteHtml(node.data, source, target, rewrite, false);
			for (const patch of inner)
				patches.push({
					...patch,
					start: location.startOffset + 4 + patch.start,
					end: location.startOffset + 4 + patch.end,
					kind: 'commented-layout-destination',
				});
		}
	}
	return patches;
}

export function stylesheetPatches(
	text: string,
	source: string,
	target: string,
	rewrite: MigrationRewrite,
	categories: readonly string[],
): MigrationPatch[] {
	const patches: MigrationPatch[] = [];
	const resources = cssUrls(text, true);
	for (const token of resources) {
		const url = text.slice(token.start, token.start + 3).toLowerCase() === 'url';
		const kind = !url && !/\.css(?:[?#]|$)/i.test(token.value) ? 'module' : 'asset';
		if (!url && /^\s*,/.test(text.slice(token.end)))
			throw new Error('Multiple stylesheet imports require an explicit migration decision');
		const value = rewrite(token.value, kind, source, target);
		if (value !== token.value)
			patches.push({
				start: token.start,
				end: token.end,
				text:
					text.slice(token.start, token.start + 3).toLowerCase() === 'url'
						? `url(${JSON.stringify(value)})`
						: JSON.stringify(value),
				kind: 'stylesheet-resource',
			});
	}
	let i = 0;
	const skipString = (start: number): number => {
		const quote = text[start];
		let end = start + 1;
		while (end < text.length) {
			if (text[end] === '\\') end += 2;
			else if (text[end++] === quote) return end;
		}
		throw new Error('Unterminated stylesheet string');
	};
	const nextBoundary = (start: number): string => {
		let p = start;
		while (p < text.length) {
			if (text.startsWith('/*', p)) {
				const end = text.indexOf('*/', p + 2);
				if (end < 0) throw new Error('Unterminated stylesheet comment');
				p = end + 2;
				continue;
			}
			if (text[p] === '"' || text[p] === "'") {
				p = skipString(p);
				continue;
			}
			if (/[;{}]/.test(text[p] ?? '')) return text[p] ?? '';
			p++;
		}
		return '';
	};
	while (i < text.length) {
		if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2);
			if (end < 0) throw new Error('Unterminated stylesheet comment');
			i = end + 2;
			continue;
		}
		if (text.startsWith('//', i)) {
			const end = text.indexOf('\n', i + 2);
			i = end < 0 ? text.length : end + 1;
			continue;
		}
		const resource = resources.find((token) => token.start === i);
		if (resource) {
			i = resource.end;
			continue;
		}
		const module = /^@(use|forward)\s+(["'])/i.exec(text.slice(i));
		if (module) {
			const start = i + module[0].length - 1;
			const end = skipString(start);
			const value = decodeCss(text.slice(start + 1, end - 1));
			const updated = rewrite(value, 'module', source, target);
			if (updated !== value)
				patches.push({ start: start + 1, end: end - 1, text: updated, kind: 'stylesheet-module' });
			i = end;
			continue;
		}
		if (text[i] === '"' || text[i] === "'") {
			i = skipString(i);
			continue;
		}
		const selector = /^#([a-z_][\w-]*)/i.exec(text.slice(i));
		if (
			selector &&
			categories.includes(selector[1] ?? '') &&
			nextBoundary(i + selector[0].length) === '{'
		) {
			patches.push({
				start: i,
				end: i + selector[0].length,
				text: `[data-category="${selector[1]}"]`,
				kind: 'category-selector',
			});
			i += selector[0].length;
			continue;
		}
		i++;
	}
	return patches;
}
