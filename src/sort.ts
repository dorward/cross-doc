import { readCategories } from './internal/validate.js';
import type { Category, Entry, ProjectOptions } from './types.js';

export default async function sortPromise(
	options: ProjectOptions,
): Promise<{ sort: <T extends Entry>(data: T[]) => T[] }> {
	return sortCategories(await readCategories(options.project));
}

export function sortCategories(categories: readonly Category[]): {
	sort: <T extends Entry>(data: T[]) => T[];
} {
	const byId = new Map(
		categories.map((category, index) => [category.category, { ...category, index }]),
	);
	const sort = <T extends Entry>(data: T[]): T[] => {
		for (const entry of data) {
			const category = byId.get(entry.type);
			if (!category) throw new Error(`Unknown category ${entry.type} for ${entry.title}`);
			if (category.sort === 'date' && !entry.date)
				throw new Error(`Missing date for chronological entry ${entry.slug}`);
		}
		return data.sort((a, b) => {
			const first = byId.get(a.type);
			const second = byId.get(b.type);
			if (!first || !second) throw new Error('Unknown category');
			if (first.index !== second.index) return first.index - second.index;
			if (first.sort === 'date' && a.date && b.date) {
				const difference = new Date(a.date).getTime() - new Date(b.date).getTime();
				if (difference) return difference;
			}
			return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
		});
	};
	return { sort };
}
