import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { app, utilityProcess } from 'electron';
import { compile } from './pipeline.mjs';

app.setPath('userData', process.env.CROSS_DOC_ELECTRON_USER_DATA);
app.disableHardwareAcceleration();
async function run() {
	let child;
	const deadline = setTimeout(() => {
		console.error('Electron test timed out');
		app.exit(1);
	}, 60000);
	try {
		await app.whenReady();
		console.log('Electron app ready');
		const project = process.env.CROSS_DOC_ELECTRON_PROJECT;
		const pdf = process.env.CROSS_DOC_TEST_PRINCE === '1';
		const binary = process.env.CROSS_DOC_PRINCE_BINARY;
		const main = await compile(project, pdf, binary);
		assert.equal(main.electron, process.env.CROSS_DOC_ELECTRON_VERSION);
		child = utilityProcess.fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
			stdio: 'pipe',
		});
		child.stderr.on('data', (data) => process.stderr.write(data));
		await once(child, 'spawn');
		const request = (job) =>
			new Promise((resolve, reject) => {
				const onExit = (code) => {
					child.off('message', onMessage);
					reject(new Error(`Utility process exited: ${code}`));
				};
				const onMessage = (message) => {
					child.off('exit', onExit);
					resolve(message);
				};
				child.once('exit', onExit);
				child.once('message', onMessage);
				child.postMessage(job);
			});
		const result = await request({ project, pdf, binary });
		assert.equal(result.ok, true, result.error?.message);
		assert.deepEqual(result.result, main);
		const failure = await request({ project: `${project}/does-not-exist`, pdf: false });
		assert.equal(failure.ok, false);
		assert.equal(failure.error.code, 'ENOENT');
		console.log(
			`Electron ${main.electron} (Node ${main.node}): main + utility compilation, all ${main.exports} exports, error propagation${pdf ? ', real Prince output' : ''} passed`,
		);
		app.exit(0);
	} catch (error) {
		console.error(error);
		app.exit(1);
	} finally {
		clearTimeout(deadline);
		child?.kill();
	}
}
void run();
