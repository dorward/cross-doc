import type { Options } from './types.js';
import klaw from 'klaw';
import { basename } from 'node:path';

export default async (options: Options): Promise<string[]> => {
	const { include } = options;
	if (
		include !== undefined &&
		(!Array.isArray(include) || include.some((value) => typeof value !== 'string'))
	) {
		throw new TypeError('Include must be an array of slugs');
	}
	return new Promise<string[]>((resolve, reject) => {
		const paths: string[] = [];
		klaw(`${options.project}/data/`)
			.on('data', (item) => {
				if (item.stats.isFile() && item.path.endsWith('.md')) paths.push(item.path);
			})
			.on('error', reject)
			.on('end', () =>
				resolve(paths.filter((file) => !include || include.includes(basename(file, '.md')))),
			);
	});
};
