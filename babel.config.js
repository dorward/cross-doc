module.exports = function (api) {
	api.cache(true);
	return {
		presets: [
			[
				"@babel/preset-env",
				{
					targets: {
						electron: "9",
					},
					useBuiltIns: "entry",
					corejs: 3,
				},
				// "@babel/react",
			],
		],
		plugins: [
			// "@babel/plugin-transform-react-jsx",
			// "@babel/plugin-proposal-object-rest-spread",
		],
	};
};
