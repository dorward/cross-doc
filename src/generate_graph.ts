import type { Entry, GraphOptions, GraphOutputOptions, HtmlDocument } from './types.js';
import write from './internal/write.js';

const colors: Record<string, string> = {
	person: '#aaaaff',
	organisation: '#ffaaaa',
	place: '#aaffaa',
	artefact: '#aaffff',
	misc: '#ffaaff',
	event: '#ffffaa',
	todo: '#ffffff',
};
const quote = (value: string) => JSON.stringify(String(value));

export async function writeGraph($: HtmlDocument, options: GraphOutputOptions): Promise<void> {
	if (
		!options ||
		typeof options.graph_file_name !== 'string' ||
		!options.graph_file_name.trim() ||
		options.graph_file_name.includes('\0')
	)
		throw new Error('An explicit graph_file_name is required');
	const nodes = new Map<string, { label: string; category: string; connections: string[] }>();
	$('.category .entry').each((_index, entry) => {
		const element = $(entry);
		const id = element.attr('id');
		if (!id || nodes.has(id)) throw new Error(`Missing or duplicate graph node: ${id}`);
		const category = element.closest('.category').attr('id') ?? '';
		const connections = element
			.find('a[href]')
			.toArray()
			.map((link) => $(link).attr('href') ?? '')
			.filter((href) => href.startsWith('#') && !href.startsWith('#figure-'))
			.map((href) => href.slice(1));
		nodes.set(id, { label: element.find('h2').text(), category, connections });
	});
	const lines = ['digraph G {'];
	for (const [id, node] of nodes) {
		const color = Object.hasOwn(colors, node.category) ? colors[node.category] : 'black';
		lines.push(
			`  ${quote(id)} [label = ${quote(node.label)}, style = "filled", fillcolor = ${quote(color ?? 'black')}];`,
		);
	}
	const edges = new Set();
	for (const [from, node] of nodes) {
		for (const to of node.connections) {
			if (!nodes.has(to)) throw new Error(`Graph link from ${from} targets missing node ${to}`);
			const key = JSON.stringify([from, to].sort());
			if (edges.has(key)) continue;
			edges.add(key);
			lines.push(`  ${quote(from)} -> ${quote(to)} [dir = "both"];`);
		}
	}
	lines.push('}');
	await write(options.graph_file_name, `${lines.join('\n')}\n`);
}

/** @deprecated Use writeGraph with an explicit destination. The test.dot fallback remains in 2.x only. */
export default async function generateGraph(
	$: HtmlDocument,
	_data: readonly Entry[],
	options: GraphOptions = {},
): Promise<void> {
	await writeGraph($, { graph_file_name: options.graph_file_name || 'test.dot' });
}
