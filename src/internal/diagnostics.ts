import type { Diagnostic } from '../types.js';

export const copyDiagnostic = (item: Diagnostic): Diagnostic => ({
	...item,
	...(item.candidates ? { candidates: [...item.candidates] } : {}),
});
