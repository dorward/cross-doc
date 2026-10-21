import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeConsumerPolicy } from './consumer-policy.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'cross-doc-git-'));
const source = join(temporary, 'source');
const consumer = join(temporary, 'consumer');
const pnpm = process.env.npm_execpath || 'pnpm';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
	await mkdir(source);
	for (const name of [
		'src',
		'scripts',
		'package.json',
		'pnpm-lock.yaml',
		'pnpm-workspace.yaml',
		'tsconfig.json',
		'README.md',
		'LICENSE.md',
	]) {
		await cp(new URL(`../${name}`, import.meta.url), join(source, name), { recursive: true });
	}
	run('git', ['init', '-q', '-b', 'main'], source);
	run('git', ['add', '.'], source);
	run(
		'git',
		[
			'-c',
			'user.name=Package fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'-qm',
			'Distribution fixture',
		],
		source,
	);
	const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
	await mkdir(consumer);
	await writeFile(
		join(consumer, 'package.json'),
		JSON.stringify({ name: 'cross-doc-git-consumer', private: true, type: 'module' }),
	);
	const specification = `git+${pathToFileURL(source).href}#${sha}`;
	const assertPolicyUnchanged = await writeConsumerPolicy(consumer, specification);
	run(pnpm, ['add', specification], consumer);
	await assertPolicyUnchanged();
	run(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import * as api from 'cross-doc'; import assert from 'node:assert/strict'; assert.equal(Object.keys(api).length,14); assert.equal(typeof api.parse_data, 'function');`,
		],
		consumer,
	);
	console.log('Git SHA consumer: prepare generated ESM before installation; all 14 exports load');
} finally {
	await rm(temporary, { recursive: true, force: true });
}
