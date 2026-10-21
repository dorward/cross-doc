import { defineConfig } from 'vitest/config';

// YAML dates and Moment formatting must have a reproducible timezone.
process.env.TZ = 'UTC';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.mjs'],
		restoreMocks: true,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts', 'src/types.ts'],
			reporter: ['text', 'html'],
		},
	},
});
