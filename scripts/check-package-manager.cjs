'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const { packageManager } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const expected = packageManager.replace('pnpm@', '');
const actual = process.env.npm_config_user_agent?.split(' ')[0];

if (actual !== `pnpm/${expected}`) {
	console.error(
		`Use ${packageManager} for this project (received ${actual || 'no package manager'}).`,
	);
	process.exit(1);
}

for (const filename of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock']) {
	if (existsSync(resolve(root, filename))) {
		console.error(`Remove ${filename}; pnpm-lock.yaml is the only supported lockfile.`);
		process.exit(1);
	}
}

console.log(`Package manager verified: ${packageManager}`);
