import { Marked } from 'marked';
import { markedSmartypants } from 'marked-smartypants';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import { parse } from 'yaml';
import { basename } from 'node:path';
import { frontMatter as validateFrontMatter } from './internal/validate.js';
import type { FrontMatter, ParsedEntry, RawDocument } from './types.js';

const markdown = new Marked({ async: false }, markedSmartypants(), gfmHeadingId());

const frontMatter = (contents: string): FrontMatter & { __content: string } => {
	const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(contents);
	if (!opening) return { ...validateFrontMatter({}), __content: contents };
	const remainder = contents.slice(opening[0].length);
	const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(remainder);
	if (!closing) throw new Error('Unterminated front matter');
	if (closing.index > 1024 * 1024) throw new Error('Front matter exceeds 1 MiB');
	const metadata: unknown = parse(remainder.slice(0, closing.index), {
		customTags: ['timestamp'],
		maxAliasCount: 50,
		uniqueKeys: true,
	});
	return {
		...validateFrontMatter(metadata),
		__content: remainder.slice(closing.index + closing[0].length),
	};
};

export default (data: readonly RawDocument[]): ParsedEntry[] =>
	data.map(({ path, contents }) => {
		const slug = basename(path, '.md');
		try {
			const parsed = frontMatter(contents);
			return { ...parsed, html: markdown.parse(parsed.__content, { async: false }), path, slug };
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			throw new Error(`Error handling ${slug}: ${message}`, { cause });
		}
	});
