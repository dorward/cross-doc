import moment from 'moment';
import type {
	Alias,
	AliasDetails,
	Category,
	CharacterSheet,
	Figure,
	FrontMatter,
	Quality,
	QualityLevel,
} from '../types.js';
import read from '../read.js';

export function record(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date)
		throw new TypeError(`${label} must be a mapping`);
}
export function text(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !value.trim())
		throw new TypeError(`${label} must be a nonempty string`);
}
export function stringArray(value: unknown, label: string): asserts value is string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
		throw new TypeError(`${label} must be an array of nonempty strings`);
}
export function safeKeys(value: unknown, depth = 0): void {
	if (!value || typeof value !== 'object' || value instanceof Date) return;
	if (depth > 50) throw new Error('Front matter nesting exceeds 50 levels');
	for (const [key, item] of Object.entries(value)) {
		if (['__proto__', 'prototype', 'constructor'].includes(key))
			throw new Error(`Unsafe front matter key: ${key}`);
		safeKeys(item, depth + 1);
	}
}
function array(value: unknown, label: string): unknown[] {
	if (value === null) return [];
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value;
}
export function aliases(value: unknown): Alias[] {
	return array(value, 'Aliases').map((item: unknown) => {
		if (typeof item === 'string') {
			text(item, 'Alias');
			return item;
		}
		record(item, 'Alias');
		text(item.name, 'Alias name');
		const alias: AliasDetails = { name: item.name };
		for (const key of ['note', 'index'] as const) {
			if (item[key] !== undefined) {
				text(item[key], `Alias ${key}`);
				alias[key] = item[key];
			}
		}
		if (item.secret !== undefined) {
			if (typeof item.secret !== 'boolean') throw new TypeError('Alias secret must be a boolean');
			alias.secret = item.secret;
		}
		return alias;
	});
}
function figure(value: unknown): Figure {
	record(value, 'Figure');
	text(value.file, 'Figure file');
	text(value.caption, 'Figure caption');
	return { file: value.file, caption: value.caption };
}
function level(value: unknown): value is QualityLevel {
	return (
		value === 'MSTR' ||
		value === 'EXP' ||
		value === 'GD' ||
		value === 'AVG' ||
		value === 'PR' ||
		value === 'GO'
	);
}
function qualities(value: unknown, label: string): Quality[] {
	return array(value, label).map((item: unknown) => {
		record(item, label);
		text(item.name, `${label} name`);
		if (!level(item.value)) throw new TypeError(`${label} value must be a supported quality level`);
		const quality: Quality = { name: item.name, value: item.value };
		if (item.notes !== undefined) {
			text(item.notes, `${label} notes`);
			quality.notes = item.notes;
		}
		return quality;
	});
}
function points(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError(`${label} must be a nonnegative safe integer`);
	return value;
}
function sheet(value: unknown): CharacterSheet {
	record(value, 'Character sheet');
	text(value.name, 'Sheet name');
	text(value.player, 'Sheet player');
	text(value.motivation, 'Sheet motivation');
	text(value.origin, 'Sheet origin');
	record(value.heropoints, 'Hero points');
	return {
		name: value.name,
		player: value.player,
		motivation: value.motivation,
		origin: value.origin,
		heropoints: {
			current: points(value.heropoints.current, 'Current hero points'),
			max: points(value.heropoints.max, 'Maximum hero points'),
		},
		qualities: qualities(value.qualities, 'Qualities'),
		powers: qualities(value.powers, 'Powers'),
	};
}
export function frontMatter(value: unknown): FrontMatter {
	record(value, 'Front matter');
	safeKeys(value);
	text(value.type, "Mandatory 'type' attribute");
	text(value.title, "Mandatory 'title' attribute");
	const result: FrontMatter = { ...value, type: value.type, title: value.title };
	if (value.date !== undefined) {
		if (value.date instanceof Date) {
			if (!Number.isFinite(value.date.getTime())) throw new TypeError('Date must be valid');
			result.date = value.date;
		} else {
			text(value.date, 'Date');
			if (!moment(value.date, moment.ISO_8601, true).isValid())
				throw new TypeError('Date must be a valid ISO date');
			result.date = value.date;
		}
	}
	if (value.pc !== undefined) {
		text(value.pc, 'PC');
		result.pc = value.pc;
	}
	if (value.alias !== undefined) result.alias = aliases(value.alias);
	for (const key of ['also', 'summary', 'monoDirectionalLinks'] as const) {
		if (value[key] !== undefined) {
			const links = value[key] === null ? [] : value[key];
			stringArray(links, key);
			result[key] = links;
		}
	}
	if (value.expandedIndex !== undefined) {
		if (typeof value.expandedIndex !== 'boolean')
			throw new TypeError('expandedIndex must be a boolean');
		result.expandedIndex = value.expandedIndex;
	}
	if (value.figures !== undefined) {
		result.figures = array(value.figures, 'Figures').map(figure);
	}
	if (value.sheet !== undefined) result.sheet = sheet(value.sheet);
	return result;
}
export async function readCategories(project: string): Promise<Category[]> {
	const value: unknown = JSON.parse(await read(`${project}/data/categories.json`));
	if (!Array.isArray(value)) throw new TypeError('Categories must be an array');
	safeKeys(value);
	const ids = new Set<string>();
	return value.map((item: unknown) => {
		record(item, 'Category');
		text(item.category, 'Category ID');
		text(item.heading, 'Category heading');
		if (ids.has(item.category)) throw new Error(`Duplicate category: ${item.category}`);
		ids.add(item.category);
		const category: Category = { ...item, category: item.category, heading: item.heading };
		if (item.sort !== undefined) {
			if (item.sort !== 'date' && item.sort !== 'title')
				throw new TypeError('Category sort must be date or title');
			category.sort = item.sort;
		}
		return category;
	});
}
