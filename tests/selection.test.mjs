import { expect, it } from 'vitest';
import { select_files, get_files } from '../src/index.ts';
import { projectFixture } from './helpers.mjs';

const files = ['/project/data/alice.md', '/project/data/nested/bob.md'];
it('distinguishes all-entry selection from a validated explicit subset and preserves file order', () => {
	expect(select_files(files)).toEqual(files);
	expect(select_files(files, ['bob'])).toEqual([files[1]]);
	expect(select_files(files, ['bob', 'alice'])).toEqual(files);
});
it.each([[], [''], [' '], [null], 'alice', null].map((include) => ({ include })))(
	'rejects empty or malformed explicit selections: %j',
	({ include }) => {
		expect(() => select_files(files, include)).toThrow('nonempty slugs');
	},
);
it('reports every unknown and duplicate slug without silently dropping requested entries', () => {
	expect(() => select_files(files, ['alice', 'ghost', 'missing', 'alice'])).toThrow(
		'Unknown include slugs: ghost, missing; Duplicate include slugs: alice',
	);
	expect(() => select_files(files, ['alice', 'alice'])).toThrow('Duplicate include slugs: alice');
});
it('retains permissive get_files filtering for callers that need it', async () => {
	const fixture = await projectFixture();
	try {
		expect(await get_files({ project: fixture.project, include: ['missing'] })).toEqual([]);
		expect(await get_files({ project: fixture.project, include: [] })).toEqual([]);
	} finally {
		await fixture.cleanup();
	}
});
