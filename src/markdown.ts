import type { MarkedExtension } from 'marked';
import { Marked, Renderer } from 'marked';
import { markedSmartypants } from 'marked-smartypants';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import { escapeHtml } from './internal/html.js';

// An inline extension participates in Marked's lexer: never scan/replace raw document text.
const wikiExtension: MarkedExtension = {
	extensions: [
		{
			name: 'crossDocWiki',
			level: 'inline',
			start(source) {
				const found = source.indexOf('[[');
				return found === -1 ? undefined : Math.max(0, found - (source[found - 1] === '!' ? 1 : 0));
			},
			tokenizer(source) {
				if (this.lexer.state.inLink || this.lexer.state.inRawBlock) return undefined;
				const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(source);
				if (!match) return undefined;
				return {
					type: 'crossDocWiki',
					raw: match[0],
					content: match[2] ?? '',
					embed: match[1] === '!',
				};
			},
			renderer(token) {
				const content = String(token.content).replace(/\\\|/g, '|');
				if (token.embed === true || content.includes('[['))
					return `<span data-cross-doc-unsupported="${escapeHtml(token.raw)}">${escapeHtml(token.raw)}</span>`;
				const separator = content.indexOf('|');
				const target = (separator === -1 ? content : content.slice(0, separator)).trim();
				const parts = target.split('#');
				const note = (parts.shift() ?? '').split('/').at(-1)?.replace(/\.md$/, '') ?? '';
				const label =
					separator === -1
						? [note, ...parts].filter(Boolean).join(' > ')
						: content.slice(separator + 1);
				return `<a data-cross-doc-syntax="wiki" href="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
			},
		},
	],
};

const images: MarkedExtension = {
	renderer: {
		image(token) {
			const renderer = new Renderer();
			renderer.parser = this.parser;
			const html = renderer.image(token);
			return token.title ? html.replace('<img ', '<img data-cross-doc-captioned="true" ') : html;
		},
	},
};

export const markdown = new Marked(
	{ async: false },
	markedSmartypants(),
	gfmHeadingId(),
	wikiExtension,
	images,
);
export const headingMarkdown = new Marked({ async: false }, gfmHeadingId(), wikiExtension);
