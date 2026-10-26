import { load } from 'cheerio';
import { entryId, idHref } from './project_index.js';
import type { Diagnostic, Entry, LinkOptions, ProjectIndex } from './types.js';

type LinkEntry = Pick<
	Entry,
	'slug' | 'html' | 'monoDirectionalLinks' | 'vaultPath' | 'linkResolution' | 'linkReferences'
>;
export function analyzeLinks(
	data: readonly LinkEntry[],
	options: LinkOptions,
	index?: ProjectIndex,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const map = new Map<string, { targets: Set<string>; oneWay: Set<string> }>();
	for (const entry of data) {
		const { slug, html, monoDirectionalLinks } = entry;
		if (map.has(slug)) throw new Error(`Duplicate slug: ${slug}`);
		const targets = new Set<string>();
		const $ = load(html);
		$('a[href]').each((_index, element) => {
			if (entry.linkResolution && $(element).closest('pre,code,svg,math').length) return;
			const href = $(element).attr('href');
			const owner = $(element).attr('data-cross-doc-target');
			if (entry.linkResolution && owner && $(element).attr('data-cross-doc-kind') !== 'figure') {
				targets.add(owner);
				return;
			}
			if (href?.startsWith('#') && !href.startsWith('#figure-') && !href.startsWith('#figure/')) {
				let target = href.slice(1);
				if (entry.linkResolution && href.startsWith('#anchor/')) return;
				if (entry.linkResolution && href.startsWith('#heading/')) {
					try {
						target = decodeURIComponent(
							decodeURIComponent(target).split('/').slice(1, -2).join('/'),
						);
					} catch {
						/* Retain the malformed target for diagnostics. */
					}
				} else if (href.startsWith('#entry/')) {
					try {
						target = decodeURIComponent(decodeURIComponent(target).slice(6));
					} catch {
						/* Invalid fragments remain missing targets. */
					}
				}
				targets.add(target);
			}
		});
		const oneWay = new Set(monoDirectionalLinks);
		for (const link of oneWay) {
			if (
				!targets.has(link) &&
				!entry.linkReferences?.some(
					(reference) => reference.kind !== 'figure' && reference.target === link,
				)
			)
				diagnostics.push({
					code: 'unused-one-way-link',
					severity: 'warning',
					source: slug,
					target: link,
				});
		}
		map.set(slug, { targets, oneWay });
	}
	for (const [from, { targets, oneWay }] of map) {
		for (const to of targets) {
			const reciprocal = map.get(to);
			if (!reciprocal) {
				const excluded = index?.entries.some((entry) => entry.identity === to) === true;
				if (options.include?.length || excluded) data.forEach((entry) => remove_link(to, entry));
				diagnostics.push({
					code: excluded ? 'excluded-link-target' : 'missing-link-target',
					severity: 'warning',
					source: from,
					target: to,
				});
			} else if (!oneWay.has(to) && !reciprocal.targets.has(from))
				diagnostics.push({
					code: 'missing-reciprocal-link',
					severity: 'warning',
					source: from,
					target: to,
				});
		}
	}
	return diagnostics;
}

/** @deprecated Use analyzeLinks or loadProject/compileProject for structured diagnostics. */
export default function warnMissingReciprocalLinks(
	data: readonly LinkEntry[],
	options: LinkOptions,
): void {
	const diagnostics = analyzeLinks(data, options);
	let source: string | undefined;
	for (const diagnostic of diagnostics) {
		if (diagnostic.code === 'unused-one-way-link') {
			process.stderr.write(
				`${diagnostic.source} is marked as monoDirectionalLinks: ${diagnostic.target} but no such link exists\n`,
			);
			continue;
		}
		if (source !== diagnostic.source) {
			source = diagnostic.source;
			process.stderr.write(`Report for links from ${source}:\n`);
		}
		process.stderr.write(
			diagnostic.code === 'missing-link-target'
				? `\tlinks to non-existent ${diagnostic.target}\n`
				: `\tmissing reciprocal link from ${diagnostic.target}\n`,
		);
	}
}
const remove_link = (to: string, data: LinkEntry): void => {
	const $ = load(data.html);
	$('a[href]')
		.filter(
			(_index, element) =>
				$(element).attr('data-cross-doc-target') === to ||
				$(element).attr('href') === (data.vaultPath !== undefined ? idHref(entryId(to)) : `#${to}`),
		)
		.each((_index, link) => {
			const node = $(link);
			node.replaceWith(node.html() ?? '');
		});
	if ($('.see-also ul:empty').length) $('.see-also').remove();
	data.html = $.root().html() ?? '';
};
