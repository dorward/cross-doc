import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import electron from 'electron';
import { createPackage } from '@electron/asar';

const exec = promisify(execFile);
export default async function checkElectron(consumer, pnpm) {
	const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	// Leave dependencies outside ASAR, as native dependencies/binaries require real paths.
	await exec(
		pnpm,
		[
			'add',
			...Object.entries(manifest.dependencies).map(([name, version]) => `${name}@${version}`),
		],
		{ cwd: consumer },
	);
	const app = join(consumer, 'electron-app');
	await cp(new URL('../tests/electron/', import.meta.url), app, { recursive: true });
	await writeFile(
		join(app, 'package.json'),
		JSON.stringify({ name: 'cross-doc-electron-fixture', type: 'module', main: 'main.mjs' }),
	);
	await mkdir(join(app, 'node_modules'), { recursive: true });
	await cp(
		await realpath(join(consumer, 'node_modules/cross-doc')),
		join(app, 'node_modules/cross-doc'),
		{ recursive: true },
	);
	const userData = join(consumer, 'electron-user-data');
	await mkdir(userData, { recursive: true });
	const env = {
		...process.env,
		CROSS_DOC_ELECTRON_USER_DATA: userData,
		CROSS_DOC_ELECTRON_PROJECT: join(consumer, 'project'),
		CROSS_DOC_ELECTRON_VERSION: manifest.devDependencies.electron,
	};
	delete env.ELECTRON_RUN_AS_NODE;
	for (const entry of [app, join(consumer, 'app.asar')]) {
		if (entry.endsWith('.asar')) await createPackage(app, entry);
		const { stdout, stderr } = await exec(electron, [entry], {
			cwd: consumer,
			env,
			timeout: 90000,
			maxBuffer: 4 * 1024 * 1024,
		});
		assert.match(stdout, /main \+ utility compilation/);
		process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
		console.log(`Passed Electron ${entry.endsWith('.asar') ? 'ASAR' : 'unpacked'} app fixture`);
	}
}
