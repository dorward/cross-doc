import type { RawDocument } from './types.js';
import read from './read.js';

export default (files: readonly string[]): Promise<RawDocument[]> =>
	Promise.all(files.map(async (path) => ({ path, contents: await read(path) })));
