import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep temporary consumers as strict as the repository, with only the reviewed
// Sass release exempted from the release-age gate.
export async function writeConsumerPolicy(consumer, gitSpecification) {
	const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const policy = `${JSON.stringify(
		{
			strictDepBuilds: true,
			allowBuilds: {
				'@parcel/watcher': false,
				...(gitSpecification ? { [`cross-doc@${gitSpecification}`]: true } : {}),
			},
			minimumReleaseAgeStrict: true,
			minimumReleaseAgeExclude: [`sass@${manifest.dependencies.sass}`],
		},
		null,
		'\t',
	)}\n`;
	// JSON is valid YAML and preserves dependency keys without custom escaping.
	const filename = join(consumer, 'pnpm-workspace.yaml');
	await writeFile(filename, policy);
	return async () => {
		assert.equal(
			await readFile(filename, 'utf8'),
			policy,
			'consumer policy must not change during installation',
		);
	};
}
