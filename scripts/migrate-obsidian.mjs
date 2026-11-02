import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyMigration, planMigration, rollbackMigration } from '../dist/index.js';
import { canonicalDestination } from '../dist/publication_paths.js';
import { within } from '../dist/layout.js';

const usage = `Usage:
  node scripts/migrate-obsidian.mjs plan --project PROJECT --moves MOVE_MAP.json --report NEW_DIRECTORY
  node scripts/migrate-obsidian.mjs apply --plan PLAN.json --journal NEW_DIRECTORY
  node scripts/migrate-obsidian.mjs rollback --journal DIRECTORY

Planning writes only to the external report directory. Apply accepts a reviewed plan,
checks source hashes, saves exact originals in the external journal and rolls back on failure.
Use a disposable copy for rehearsal; retain the journal until conversion is accepted.
`;
try {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		strict: true,
		options: {
			project: { type: 'string' },
			moves: { type: 'string' },
			report: { type: 'string' },
			plan: { type: 'string' },
			journal: { type: 'string' },
			help: { type: 'boolean' },
		},
	});
	if (values.help) {
		process.stdout.write(usage);
	} else {
		const [command] = positionals;
		if (positionals.length !== 1) throw new Error(usage);
		if (command === 'plan') {
			if (!values.project || !values.moves || !values.report || values.plan || values.journal)
				throw new Error(usage);
			const project = resolve(values.project),
				report = resolve(values.report);
			if (within(await canonicalDestination(project), await canonicalDestination(report)))
				throw new Error('Dry-run reports must be outside the project');
			const moves = JSON.parse(await readFile(values.moves, 'utf8'));
			const plan = await planMigration({ project, moves });
			await mkdir(dirname(report), { recursive: true });
			await mkdir(report);
			await writeFile(join(report, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, {
				flag: 'wx',
			});
			const lines = [
				'# Obsidian migration dry run',
				'',
				`Project: ${plan.project}`,
				'',
				`Inputs: ${plan.inputs.length}; operations: ${plan.operations.length}; figures appended: ${plan.figures.length}; source edits: ${plan.edits.length}.`,
				'',
				'## Blocking errors',
				'',
				...plan.issues
					.filter((item) => item.severity === 'error')
					.map((item) => `- ${item.source}: ${item.message}`),
				'',
				'## Review flags',
				'',
				...plan.issues
					.filter((item) => item.severity === 'review')
					.map((item) => `- ${item.source}: ${item.message}`),
				'',
				'## Moves and generated files',
				'',
				...plan.operations.map(
					(operation) =>
						`- ${operation.source ?? '(new)'} → ${operation.target} (${operation.afterSha256})`,
				),
				'',
				'## Source edits',
				'',
				...plan.edits.flatMap((edit) => [
					`### ${edit.source}: ${edit.kind} [${edit.start}, ${edit.end})`,
					'',
					'Before:',
					'```text',
					edit.before,
					'```',
					'After:',
					'```text',
					edit.after,
					'```',
					'',
				]),
			];
			await writeFile(join(report, 'REPORT.md'), `${lines.join('\n')}\n`, { flag: 'wx' });
			process.stdout.write(
				`${JSON.stringify({ report, operations: plan.operations.length, errors: plan.issues.filter((item) => item.severity === 'error').length, alreadyMigrated: plan.alreadyMigrated })}\n`,
			);
			if (plan.issues.some((item) => item.severity === 'error')) process.exitCode = 1;
		} else if (command === 'apply') {
			if (!values.plan || !values.journal || values.project || values.moves || values.report)
				throw new Error(usage);
			const plan = JSON.parse(await readFile(values.plan, 'utf8'));
			process.stdout.write(
				`${JSON.stringify(await applyMigration(plan, { journalDirectory: values.journal }))}\n`,
			);
		} else if (command === 'rollback') {
			if (!values.journal || values.plan || values.project || values.moves || values.report)
				throw new Error(usage);
			process.stdout.write(`${JSON.stringify(await rollbackMigration(values.journal))}\n`);
		} else throw new Error(usage);
	}
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
