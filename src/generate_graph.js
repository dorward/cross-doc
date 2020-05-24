import graphviz from "graphviz";
import write from "write";

const fig = /^figure-/;
const colors = {
	person: "#aaaaff",
	organisation: "#ffaaaa",
	place: "#aaffaa",
	artefact: "#aaffff",
	misc: "#ffaaff",
	event: "#ffffaa",
	todo: "#ffffff"
};

export default async ($, data, options) => {
	const $sections = $(".category");
	const nodes = {};
	$sections.each((_index, element) => {
		const $e = $(element);
		const category_id = $e.attr("id");
		const $entries = $e.find(".entry");
		$entries.each((_index, entry) => {
			const $en = $(entry);
			const entry_id = $en.attr("id");
			const label = $en.find("h2").text();
			const links = $en.find("a");
			const connections = [];
			$(links).each( (_index, link) => {
				const connection_id = $(link).attr("href").replace("#", "");
				if (connection_id.match(fig)) return;
				connections.push(connection_id);
			});
			nodes[entry_id] = {label, category_id, connections, connected: {}};
		});
	});
    
	const g = graphviz.digraph("G");
	Object.entries(nodes).forEach(entry => {
		const [key, value] = entry;
		const n = g.addNode(key);
		n.set("label", value.label);
		n.set("style", "filled");
		colors[value.category_id] || console.log(value.category_id);
		n.set("fillcolor", colors[value.category_id] || "black");
		value.node = n;
	});
    
	Object.entries(nodes).forEach(entry => {
		const [from_name, from] = entry;
		from.connections.forEach(to_name => {
			// Test if connection there already
			if (from.connected[to_name]) return;
			// Register connection
			const to = nodes[to_name];
			from.connected[to_name] = true;
			to.connected[from_name] = true;
			// Add graph
			g.addEdge(from.node, to.node, { dir: "both" });
		});
	});

	write("test.dot", g.to_dot());

};