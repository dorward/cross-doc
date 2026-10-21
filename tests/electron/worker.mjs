import { compile } from './pipeline.mjs';

process.parentPort.on('message', async ({ data }) => {
	try {
		const result = await compile(data.project, data.pdf, data.binary);
		process.parentPort.postMessage({ ok: true, result });
	} catch (error) {
		process.parentPort.postMessage({
			ok: false,
			error: { message: error.message, code: error.code },
		});
	}
});
