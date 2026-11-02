import { record, safeKeys } from './metadata.js';
import type { ProjectPaths } from './browser/types.js';
export function relativeProjectPath(value: unknown, label: string): asserts value is string {
	if (
		typeof value !== 'string' ||
		!value.length ||
		/^[a-z]:/i.test(value) ||
		/[\\]/.test(value) ||
		Array.from(value).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`${label} must be a safe root-relative path: ${JSON.stringify(value)}`);
	}
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	if (
		keys.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error(`${label} must contain exactly: ${keys.join(', ')}`);
}
export function projectPaths(data: unknown): ProjectPaths {
	record(data, 'Project configuration');
	safeKeys(data);
	exact(data, ['version', 'identity', 'paths'], 'Project configuration');
	if (data.version !== 1 || data.identity !== 'vault-path-v1')
		throw new Error('Unsupported project configuration version/identity');
	record(data.paths, 'Project paths');
	const keys = ['entries', 'attachments', 'categories', 'layout', 'themes', 'legacyLinks'] as const;
	exact(data.paths, keys, 'Project paths');
	for (const key of keys) relativeProjectPath(data.paths[key], `paths.${key}`);
	// The assertions above narrow indexed values at runtime; spell out the validated record.
	const paths: ProjectPaths = {
		entries: String(data.paths.entries),
		attachments: String(data.paths.attachments),
		categories: String(data.paths.categories),
		layout: String(data.paths.layout),
		themes: String(data.paths.themes),
		legacyLinks: String(data.paths.legacyLinks),
	};
	return paths;
}
