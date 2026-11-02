import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectFixture } from './helpers.mjs';
import { migrationInventory } from '../src/migration.ts';
let fixture, external, mapFile;
const executable = fileURLToPath(new URL('../scripts/migrate-obsidian.mjs', import.meta.url));
const run = (args) =>
	spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', timeout: 15000 });
beforeEach(async () => {
	fixture = await projectFixture();
	external = await mkdtemp(join(tmpdir(), 'cross-doc-migrate-cli-'));
	const inputs = await migrationInventory(fixture.project);
	const moves = inputs.map((input) => ({
		source: input.path,
		sha256: input.sha256,
		target:
			input.path === 'data/categories.json'
				? 'publishing/categories.json'
				: input.path.startsWith('data/')
					? input.path.replace('data/', 'notes/')
					: input.path === 'templates/index.html'
						? 'publishing/layout.html'
						: input.path.startsWith('templates/')
							? input.path.replace('templates/', 'publishing/themes/')
							: input.path.replace('resources/', 'attachments/'),
	}));
	mapFile = join(external, 'moves.json');
	await writeFile(mapFile, JSON.stringify(moves));
});
afterEach(async () => {
	await fixture.cleanup();
	await rm(external, { recursive: true, force: true });
});
it('defaults to explicit dry-run/apply/rollback subcommands and supports a reviewed JSON plan', async () => {
	const before = await migrationInventory(fixture.project),
		report = join(external, 'report'),
		journal = join(external, 'journal');
	const planned = run([
		'plan',
		'--project',
		fixture.project,
		'--moves',
		mapFile,
		'--report',
		report,
	]);
	expect(planned.status).toBe(0);
	expect(JSON.parse(planned.stdout).errors).toBe(0);
	expect(await migrationInventory(fixture.project)).toEqual(before);
	expect(await readFile(join(report, 'REPORT.md'), 'utf8')).toContain('remove-figures-frontmatter');
	const applied = run(['apply', '--plan', join(report, 'plan.json'), '--journal', journal]);
	expect(applied.status, applied.stderr).toBe(0);
	expect(JSON.parse(applied.stdout).status).toBe('applied');
	const rolledBack = run(['rollback', '--journal', journal]);
	expect(rolledBack.status, rolledBack.stderr).toBe(0);
	expect(await migrationInventory(fixture.project)).toEqual(before);
});
it('refuses dry-run report writes inside the project', async () => {
	const result = run([
		'plan',
		'--project',
		fixture.project,
		'--moves',
		mapFile,
		'--report',
		join(fixture.project, 'report'),
	]);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain('outside the project');
});
it('keeps existing report directories intact and returns nonzero for blocking plans', async () => {
	const occupied = join(external, 'occupied');
	await mkdir(occupied);
	await writeFile(join(occupied, 'keep'), 'keep');
	expect(
		run(['plan', '--project', fixture.project, '--moves', mapFile, '--report', occupied]).status,
	).toBe(1);
	expect(await readFile(join(occupied, 'keep'), 'utf8')).toBe('keep');
	const moves = JSON.parse(await readFile(mapFile, 'utf8'));
	moves[0].sha256 = '0'.repeat(64);
	await writeFile(mapFile, JSON.stringify(moves));
	const report = join(external, 'invalid');
	const result = run([
		'plan',
		'--project',
		fixture.project,
		'--moves',
		mapFile,
		'--report',
		report,
	]);
	expect(result.status).toBe(1);
	expect(JSON.parse(result.stdout).errors).toBeGreaterThan(0);
	expect(await readFile(join(report, 'REPORT.md'), 'utf8')).toContain('hash differs');
});
it('shows help without inspecting a project and refuses implicit application', () => {
	expect(run(['--help']).stdout).toContain('Planning writes only');
	const result = run(['--project', fixture.project]);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain('Usage:');
});
