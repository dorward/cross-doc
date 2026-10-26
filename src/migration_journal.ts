import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rmdir,
	unlink,
	writeFile,
	link,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { canonicalDestination, missingPath } from './publication_paths.js';
import { relativeProjectPath, within } from './layout.js';
import { portablePathKey } from './project_index.js';
import { safeKeys } from './internal/validate.js';
import { migrationHash, migrationInventory, migrationJson } from './migration.js';
import { loadProject } from './project.js';
import type {
	MigrationApplyOptions,
	MigrationJournal,
	MigrationPlan,
	MigrationResult,
} from './types.js';

async function safePath(project: string, path: string): Promise<string> {
	relativeProjectPath(path, 'Migration journal path');
	const root = await realpath(project);
	let current = root;
	for (const part of path.split('/')) {
		current = join(current, part);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new Error(`Migration path became a symlink: ${path}`);
		} catch (error) {
			if (!missingPath(error)) throw error;
		}
	}
	if (!within(root, await canonicalDestination(current)))
		throw new Error(`Migration path escapes project: ${path}`);
	return current;
}
function validatePlan(plan: MigrationPlan): void {
	safeKeys(plan);
	if (
		plan.version !== 1 ||
		!Array.isArray(plan.operations) ||
		!Array.isArray(plan.inputs) ||
		!Array.isArray(plan.issues)
	)
		throw new Error('Invalid migration plan');
	const targets = new Set<string>();
	const sources = new Map(plan.inputs.map((input) => [input.path, input]));
	for (const input of plan.inputs) {
		relativeProjectPath(input.path, 'Input path');
		if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid input hash');
	}
	for (const operation of plan.operations) {
		relativeProjectPath(operation.target, 'Operation target');
		if (!/^(?:notes|attachments|publishing|artwork|drafts)\//.test(operation.target))
			throw new Error('Invalid migration target root');
		const key = portablePathKey(operation.target);
		if (
			[...targets].some(
				(target) => target === key || target.startsWith(`${key}/`) || key.startsWith(`${target}/`),
			)
		)
			throw new Error('Colliding migration targets');
		targets.add(key);
		if (operation.source) {
			relativeProjectPath(operation.source, 'Operation source');
			if (sources.get(operation.source)?.sha256 !== operation.beforeSha256)
				throw new Error('Operation source does not match inventory');
			if (operation.source === operation.target)
				throw new Error('Migration does not permit in-place replacements');
		} else if (operation.contents === undefined) throw new Error('Created files require contents');
		if (
			operation.contents !== undefined &&
			migrationHash(operation.contents) !== operation.afterSha256
		)
			throw new Error('Operation contents do not match planned hash');
		if (
			!/^[a-f0-9]{64}$/.test(operation.afterSha256) ||
			!Number.isInteger(operation.mode) ||
			operation.mode < 0 ||
			operation.mode > 0o777
		)
			throw new Error('Invalid operation hash/mode');
	}
	if (plan.operations.some((operation) => sources.has(operation.target)))
		throw new Error('Move target overlaps original input');
}
async function currentHash(path: string): Promise<string | undefined> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink())
			throw new Error(`Expected regular migration file: ${path}`);
		return migrationHash(await readFile(path));
	} catch (error) {
		if (missingPath(error)) return undefined;
		throw error;
	}
}
const backupName = (directory: string, index: number): string =>
	join(directory, 'originals', `${index}.bin`);
async function persist(directory: string, journal: MigrationJournal): Promise<void> {
	const path = join(directory, 'journal.json');
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe migration journal file');
	} catch (error) {
		if (!missingPath(error)) throw error;
	}
	const temp = join(directory, `.journal-${randomUUID()}.tmp`);
	await writeFile(temp, migrationJson(journal), { flag: 'wx', mode: 0o600 });
	await rename(temp, path);
}
async function ensureDirectory(
	directory: string,
	journal: MigrationJournal,
	path: string,
): Promise<void> {
	const root = journal.plan.project;
	const relativePath = relative(root, path).split(sep).join('/');
	if (!relativePath) return;
	await safePath(root, relativePath);
	let current = root;
	for (const part of relativePath.split('/')) {
		current = join(current, part);
		try {
			const info = await lstat(current);
			if (!info.isDirectory() || info.isSymbolicLink())
				throw new Error(`Invalid target directory: ${current}`);
		} catch (error) {
			if (!missingPath(error)) throw error;
			const created = relative(root, current).split(sep).join('/');
			if (!journal.createdDirectories.includes(created)) journal.createdDirectories.push(created);
			await persist(directory, journal);
			await mkdir(current);
		}
	}
}
async function commit(
	directory: string,
	journal: MigrationJournal,
	path: string,
	bytes: Buffer,
	mode: number,
): Promise<void> {
	const target = await safePath(journal.plan.project, path);
	await ensureDirectory(directory, journal, dirname(target));
	const temp = join(dirname(target), `.cross-doc-migration-${randomUUID()}.tmp`);
	journal.temporaryFiles.push({
		path: relative(journal.plan.project, temp).split(sep).join('/'),
		sha256: migrationHash(bytes),
	});
	await persist(directory, journal);
	await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
	await chmod(temp, mode);
	// A same-directory hard link commits atomically and refuses to replace a raced-in target.
	await link(temp, target);
	await unlink(temp);
}
function normalizedDiagnostics(plan: MigrationPlan, items: MigrationPlan['diagnostics']): string[] {
	const aliases = new Map(plan.legacyLinks.entries.map((item) => [item.target, item.legacySlug]));
	return items
		.filter((item) => item.code !== 'legacy-reference')
		.map((item) =>
			JSON.stringify({
				...item,
				source: aliases.get(item.source) ?? item.source,
				target: aliases.get(item.target) ?? item.target,
			}),
		)
		.sort();
}

export async function applyMigration(
	plan: MigrationPlan,
	options: MigrationApplyOptions,
): Promise<MigrationResult> {
	validatePlan(plan);
	if (plan.issues.some((issue) => issue.severity === 'error'))
		throw new Error('Migration plan contains blocking errors');
	if (plan.alreadyMigrated || plan.operations.length === 0)
		throw new Error('Migration plan has no changes to apply');
	const root = await realpath(plan.project);
	if (root !== plan.project) throw new Error('Migration project root changed');
	const journalDirectory = resolve(options.journalDirectory);
	const actual = await canonicalDestination(journalDirectory);
	if (within(root, actual)) throw new Error('Rollback journal must be outside the project');
	try {
		await lstat(journalDirectory);
		throw new Error('Rollback journal destination already exists');
	} catch (error) {
		if (!missingPath(error)) throw error;
	}
	const inventory = await migrationInventory(root);
	if (migrationJson(inventory) !== migrationJson(plan.inputs))
		throw new Error('Migration inputs changed since planning');
	for (const operation of plan.operations) {
		const target = await safePath(root, operation.target);
		if ((await currentHash(target)) !== undefined)
			throw new Error(`Migration target appeared after planning: ${operation.target}`);
		if (operation.source) await safePath(root, operation.source);
	}
	await mkdir(journalDirectory, { recursive: true, mode: 0o700 });
	await mkdir(join(journalDirectory, 'originals'));
	const journal: MigrationJournal = {
		version: 1,
		status: 'prepared',
		plan,
		createdDirectories: [],
		temporaryFiles: [],
	};
	await persist(journalDirectory, journal);
	try {
		// Complete and verify every backup before modifying a single input.
		for (const [index, operation] of plan.operations.entries())
			if (operation.source) {
				const source = await safePath(root, operation.source);
				await copyFile(source, backupName(journalDirectory, index), constants.COPYFILE_EXCL);
				await chmod(backupName(journalDirectory, index), 0o600);
				if ((await currentHash(backupName(journalDirectory, index))) !== operation.beforeSha256)
					throw new Error(`Backup mismatch: ${operation.source}`);
			}
		journal.status = 'applying';
		await persist(journalDirectory, journal);
		for (const [index, operation] of plan.operations.entries()) {
			const bytes =
				operation.contents === undefined
					? await readFile(backupName(journalDirectory, index))
					: Buffer.from(operation.contents);
			await commit(journalDirectory, journal, operation.target, bytes, operation.mode);
			if ((await currentHash(await safePath(root, operation.target))) !== operation.afterSha256)
				throw new Error(`Target verification failed: ${operation.target}`);
			if (operation.source) {
				const source = await safePath(root, operation.source);
				if ((await currentHash(source)) !== operation.beforeSha256)
					throw new Error(`Input changed during application: ${operation.source}`);
				await unlink(source);
			}
		}
		const loaded = await loadProject({ project: root });
		if (
			loaded.entries.length !== plan.legacyLinks.entries.length ||
			migrationJson(normalizedDiagnostics(plan, loaded.diagnostics)) !==
				migrationJson(normalizedDiagnostics(plan, plan.diagnostics))
		)
			throw new Error('Migrated project has unexplained entry/diagnostic changes');
		journal.status = 'applied';
		await persist(journalDirectory, journal);
		return { journalDirectory, status: 'applied', files: plan.operations.length };
	} catch (cause) {
		try {
			await rollbackMigration(journalDirectory);
		} catch (rollback) {
			throw new AggregateError(
				[cause, rollback],
				`Migration failed and automatic rollback could not complete; preserve ${journalDirectory}`,
			);
		}
		throw new Error(
			`Migration failed; automatic rollback completed. Journal: ${journalDirectory}`,
			{ cause },
		);
	}
}

export async function rollbackMigration(directory: string): Promise<MigrationResult> {
	const journalDirectory = await realpath(directory);
	const journal = JSON.parse(
		await readFile(join(journalDirectory, 'journal.json'), 'utf8'),
	) as MigrationJournal;
	if (
		journal.version !== 1 ||
		!Array.isArray(journal.createdDirectories) ||
		!Array.isArray(journal.temporaryFiles)
	)
		throw new Error('Invalid rollback journal');
	validatePlan(journal.plan);
	const { plan } = journal;
	if (within(await realpath(plan.project), journalDirectory))
		throw new Error('Rollback journal must be outside project');
	// Preflight the whole batch: no clobbering edits made after conversion or a partial run.
	for (const [index, operation] of plan.operations.entries()) {
		const target = await currentHash(await safePath(plan.project, operation.target));
		if (target !== undefined && target !== operation.afterSha256)
			throw new Error(`Rollback conflict at migrated target: ${operation.target}`);
		if (operation.source) {
			const source = await currentHash(await safePath(plan.project, operation.source));
			if (source !== undefined && source !== operation.beforeSha256)
				throw new Error(`Rollback conflict at original source: ${operation.source}`);
			if (
				source === undefined &&
				(await currentHash(backupName(journalDirectory, index))) !== operation.beforeSha256
			)
				throw new Error(`Rollback backup missing or corrupt: ${operation.source}`);
		}
	}
	for (const temp of journal.temporaryFiles) {
		const hash = await currentHash(await safePath(plan.project, temp.path));
		if (hash !== undefined && hash !== temp.sha256)
			throw new Error(`Rollback temporary-file conflict: ${temp.path}`);
	}
	journal.status = 'rolling-back';
	await persist(journalDirectory, journal);
	for (const [index, operation] of [...plan.operations.entries()].reverse()) {
		if (operation.source) {
			const source = await safePath(plan.project, operation.source);
			if ((await currentHash(source)) === undefined)
				await commit(
					journalDirectory,
					journal,
					operation.source,
					await readFile(backupName(journalDirectory, index)),
					operation.mode,
				);
		}
		const target = await safePath(plan.project, operation.target);
		const hash = await currentHash(target);
		if (hash !== undefined) {
			if (hash !== operation.afterSha256)
				throw new Error(`Rollback target changed during restoration: ${operation.target}`);
			await unlink(target);
		}
	}
	for (const temp of journal.temporaryFiles) {
		const path = await safePath(plan.project, temp.path);
		if ((await currentHash(path)) !== undefined) await unlink(path);
	}
	for (const path of [...journal.createdDirectories].sort(
		(a, b) => b.split('/').length - a.split('/').length,
	)) {
		try {
			await rmdir(await safePath(plan.project, path));
		} catch (error) {
			if (
				!(
					error instanceof Error &&
					'code' in error &&
					['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))
				)
			)
				throw error;
		}
	}
	journal.status = 'rolled-back';
	await persist(journalDirectory, journal);
	return { journalDirectory, status: 'rolled-back', files: plan.operations.length };
}
