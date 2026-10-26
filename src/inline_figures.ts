import { load } from 'cheerio';
import type { HtmlDocument } from './types.js';

// Only a Markdown image occupying a complete paragraph is a captioned figure.
export const inlineImages = ($: HtmlDocument): ReturnType<HtmlDocument> =>
	$('p > img[data-cross-doc-captioned]').filter((_i, node) => {
		const image = $(node);
		const parent = image.parent();
		return (
			!image.closest('pre,code,svg,math,figure').length &&
			parent.children().length === 1 &&
			parent.text().trim() === ''
		);
	});

export const inlineFigureCount = (html: string): number => inlineImages(load(html)).length;
