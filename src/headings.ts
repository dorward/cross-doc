import { load } from 'cheerio';
import { headingMarkdown } from './markdown.js';
import { encodeIdentity } from './project_index.js';
import type {
	AnchorRecord,
	HeadingRecord,
	HeadingIndex,
	ParsedEntry,
	ProjectIndex,
} from './types.js';

export const headingText = (text: string): string => text.trim().replace(/\s+/g, ' ');
export function indexHeadings(entries: readonly ParsedEntry[], index: ProjectIndex): HeadingIndex {
	const headings: HeadingRecord[] = [];
	const anchors: AnchorRecord[] = [];
	const documents = entries.map((entry) => {
		const owner = index.entries.find((item) => item.identity === entry.slug);
		if (!owner) throw new Error(`Entry is not in project index: ${entry.slug}`);
		const $ = load(entry.html);
		const plain = load(headingMarkdown.parse(entry.__content, { async: false }));
		const plainHeadings = plain('h1,h2,h3,h4,h5,h6')
			.toArray()
			.filter((node) => !plain(node).closest('pre,code,svg,math,script,style').length);
		let headingIndex = 0;
		const counts = new Map<string, number>();
		const parents: Pick<HeadingRecord, 'level' | 'text'>[] = [];
		let firstTitle = true;
		$('h1,h2,h3,h4,h5,h6').each((_i, node) => {
			if ($(node).closest('pre,code,svg,math,script,style').length) return;
			const element = $(node);
			const original = plainHeadings[headingIndex++];
			const text = headingText(original ? plain(original).text() : element.text());
			const level = Number(node.tagName.slice(1));
			const occurrence = (counts.get(text) ?? 0) + 1;
			counts.set(text, occurrence);
			while (parents.length && (parents.at(-1)?.level ?? 0) >= level) parents.pop();
			const trail = [...parents.map((parent) => parent.text), text];
			const legacyId = element.attr('id');
			const title = level === 1 && firstTitle;
			if (title) firstTitle = false;
			const id = title
				? owner.id
				: `heading/${encodeIdentity(owner.identity)}/${encodeURIComponent(text)}/${occurrence}`;
			headings.push({
				owner: owner.identity,
				text,
				level,
				trail,
				occurrence,
				id,
				...(legacyId ? { legacyId } : {}),
			});
			// The entry wrapper will own the first title's ID after cleanup.
			if (title) element.removeAttr('id');
			else element.attr('id', id);
			parents.push({ level, text });
		});
		const anchorCounts = new Map<string, number>();
		$('[id],a[name]').each((_i, node) => {
			const element = $(node);
			if (
				element.is('h1,h2,h3,h4,h5,h6') ||
				element.closest('pre,code,svg,math,script,style').length
			)
				return;
			const name = element.attr('name');
			const original = element.attr('id') ?? name;
			if (!original) return;
			const occurrence = (anchorCounts.get(original) ?? 0) + 1;
			anchorCounts.set(original, occurrence);
			const id = `anchor/${encodeIdentity(owner.identity)}/${encodeURIComponent(original)}/${occurrence}`;
			element.attr('id', id);
			if (element.attr('name') !== undefined) element.attr('name', id);
			anchors.push({ owner: owner.identity, original, occurrence, id });
			if (name && name !== original) {
				const nameOccurrence = (anchorCounts.get(name) ?? 0) + 1;
				anchorCounts.set(name, nameOccurrence);
				anchors.push({ owner: owner.identity, original: name, occurrence: nameOccurrence, id });
			}
		});
		return { ...entry, html: $('body').html() ?? '', linkResolution: true };
	});
	return { entries: documents, headings, anchors };
}
