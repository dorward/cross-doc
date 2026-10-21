import { load } from 'cheerio';
import type { Diagnostic, Entry, LinkOptions } from './types.js';

type LinkEntry = Pick<Entry, 'slug' | 'html' | 'monoDirectionalLinks'>;
export function analyzeLinks(data: readonly LinkEntry[], options: LinkOptions): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const map = new Map<string, { targets: Set<string>; oneWay: Set<string> }>();
	for (const entry of data) {
		const { slug, html, monoDirectionalLinks } = entry;
		if (map.has(slug)) throw new Error(`Duplicate slug: ${slug}`);
		const targets = new Set<string>();
		const $ = load(html);
		$('a[href]').each((_index, element) => {
			const href = $(element).attr('href');
			if (href?.startsWith('#') && !href.startsWith('#figure-')) targets.add(href.slice(1));
		});
		const oneWay = new Set(monoDirectionalLinks);
		for (const link of oneWay) {
			if (!targets.has(link))
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
				if (options.include?.length) data.forEach((entry) => remove_link(to, entry));
				diagnostics.push({
					code: 'missing-link-target',
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
		.filter((_index, element) => $(element).attr('href') === `#${to}`)
		.each((_index, link) => {
			const node = $(link);
			node.replaceWith(node.html() ?? '');
		});
	if ($('.see-also ul:empty').length) $('.see-also').remove();
	data.html = $.root().html() ?? '';
};
