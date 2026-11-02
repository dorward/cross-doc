import type { MigrationPatch } from '../types.js';

export function applyPatches(text: string, patches: readonly MigrationPatch[]): string {
	let boundary = text.length;
	let result = text;
	for (const patch of [...patches].sort((a, b) => b.start - a.start || b.end - a.end)) {
		if (patch.start < 0 || patch.end < patch.start || patch.end > boundary)
			throw new Error('Overlapping or invalid source edits');
		result = result.slice(0, patch.start) + patch.text + result.slice(patch.end);
		boundary = patch.start;
	}
	return result;
}
