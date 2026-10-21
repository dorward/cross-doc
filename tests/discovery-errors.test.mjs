import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';

const walk = vi.hoisted(() => vi.fn());
vi.mock('klaw', () => ({ default: walk }));
import getFiles from '../src/get_files.ts';

it('rejects invalid include before starting a walker', async () => {
	walk.mockClear();
	await expect(getFiles({ project: '/fixture', include: 'invalid' })).rejects.toThrow(
		'Include must be an array of slugs',
	);
	expect(walk).not.toHaveBeenCalled();
});

it('rejects missing-directory errors from the walker', async () => {
	const walker = new EventEmitter();
	walk.mockReturnValue(walker);
	const result = getFiles({ project: '/missing-fixture' });
	const assertion = expect(result).rejects.toMatchObject({ code: 'ENOENT' });
	walker.emit('error', Object.assign(new Error('directory missing'), { code: 'ENOENT' }));
	await assertion;
});
