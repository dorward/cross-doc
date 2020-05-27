import klaw from "klaw";

const isMd = /\.md$/;

export default (options) => {
	const paths = [];
	return new Promise( (res) => {
		klaw(`${options.project}/data/`)
			.on("data", item => {
				paths.push(item.path);
			})
			.on("end", () => {
				const mds = paths.filter(file => isMd.test(file));
				const {include} = options;
				if (!include) return res(mds);
				if (!Array.isArray(include)) throw "Include is not an array";
				const name_regex = /([^/]+)\.md$/;
				const included = mds.filter(file => {
					const name = file.match(name_regex)[1];
					return include.includes(name);
				});
				res(included);
			});
	});
	
};
