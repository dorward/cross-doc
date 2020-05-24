import readFile from "fs-readfile-promise";

export default async (files) => {
	const promises = files.map(read_file);
	const content = await Promise.all(promises);
	return content;
};

const read_file = async (path) => {
	const buffer = await readFile(path);
	return {
		path,
		contents: buffer.toString()
	};
};
