import readFile from "read-file";

export default filename => new Promise(
	res =>  readFile(filename, "utf-8", (err, data) => res(data))
);
