import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export default async (filename: string, contents: string | Uint8Array): Promise<void> => {
	await mkdir(dirname(filename), { recursive: true });
	await writeFile(filename, contents);
};
