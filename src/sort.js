import read from "./read.js";

export default async function sortPromise(options) {
	const detailed_types = JSON.parse(await read(`${options.project}/data/categories.json`));
	const types = detailed_types.map((type) => type.category);
	const sort = (data) => data.sort(rules);
	const by_date = (entry) =>
		detailed_types.find((c) => c.category === entry.type).sort === "date";
	const rules = (a, b) => {
		if (by_date(a) && by_date(b)) {
			// Only some kinds of record should be sorted by date
			if (a.date < b.date) return -1;
			if (a.date > b.date) return 1;
		}
		if (types.indexOf(a.type) < types.indexOf(b.type)) return -1;
		if (types.indexOf(a.type) > types.indexOf(b.type)) return 1;
		if (a.title < b.title) return -1;
		if (a.title > b.title) return 1;
		return 0;
	};

	return {sort};
}
