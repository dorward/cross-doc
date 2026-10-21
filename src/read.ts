import { readFile } from 'node:fs/promises';

export default (filename: string): Promise<string> => readFile(filename, 'utf8');
