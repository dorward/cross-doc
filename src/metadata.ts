import moment from 'moment';
import { parse } from 'yaml';
import type {
	Alias,
	AliasDetails,
	Category,
	CharacterSheet,
	Figure,
	FrontMatter,
	InventoryItem,
	Quality,
	QualityLevel,
} from './browser/types.js';
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
			optionalString(item.notes, `${label} notes`);
			quality.notes = item.notes;
		}
		if (item.id !== undefined) {
			text(item.id, `${label} ID`);
			quality.id = item.id;
		}
		if (item.wounds !== undefined) quality.wounds = points(item.wounds, `${label} wounds`);
		return quality;
	});
}
function points(value: unknown, label: string): number {
	if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError(`${label} must be a nonnegative safe integer`);
	return value;
}
function optionalString(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
}
function inventory(value: unknown, references: boolean): InventoryItem[] {
	const items = array(value, 'Inventory').map((raw): InventoryItem => {
		record(raw, 'Inventory item');
		text(raw.name, 'Inventory name');
		optionalString(raw.location, 'Inventory location');
		const item: InventoryItem = {
			name: raw.name,
			location: raw.location,
			count:
				raw.count === null || raw.count === '∞' ? raw.count : points(raw.count, 'Inventory count'),
			value: raw.value === null ? null : points(raw.value, 'Inventory value'),
		};
		if (raw.id !== undefined) {
			text(raw.id, 'Inventory ID');
			item.id = raw.id;
		}
		if (raw.capacity !== undefined) item.capacity = points(raw.capacity, 'Inventory capacity');
		if (raw.isExpanded !== undefined) {
			if (typeof raw.isExpanded !== 'boolean')
				throw new TypeError('Inventory isExpanded must be a boolean');
			item.isExpanded = raw.isExpanded;
		}
		return item;
	});
	const byId = new Map<string, InventoryItem>();
	for (const item of items) {
		if (!item.id) continue;
		if (byId.has(item.id)) throw new TypeError(`Duplicate inventory ID: ${item.id}`);
		byId.set(item.id, item);
	}
	if (references)
		for (const item of items) {
			const seen = new Set<InventoryItem>([item]);
			let cursor = item;
			while (cursor.location) {
				const parent = byId.get(cursor.location);
				if (!parent || parent.capacity === undefined)
					throw new TypeError(`Missing inventory container: ${cursor.location}`);
				if (seen.has(parent)) throw new TypeError('Inventory location cycle');
				seen.add(parent);
				cursor = parent;
			}
		}
	return items;
}
function sheet(value: unknown): CharacterSheet {
	if (typeof value === 'string') {
		if (value.length > 1024 * 1024) throw new Error('Character sheet exceeds 1 MiB');
		value = parse(value, { maxAliasCount: 50, uniqueKeys: true });
		safeKeys(value);
	}
	record(value, 'Character sheet');
	text(value.name, 'Sheet name');
	text(value.player, 'Sheet player');
	text(value.motivation, 'Sheet motivation');
	text(value.origin, 'Sheet origin');
	record(value.heropoints, 'Hero points');
	const result: CharacterSheet = {
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
	for (const key of ['id', 'codeName', 'avatar', 'background'] as const) {
		if (value[key] !== undefined) {
			optionalString(value[key], `Sheet ${key}`);
			result[key] = value[key];
		}
	}
	if (value.bennies !== undefined) {
		record(value.bennies, 'Bennies');
		result.bennies = {
			current: points(value.bennies.current, 'Current bennies'),
			max: points(value.bennies.max, 'Maximum bennies'),
		};
	}
	if (value.inventory !== undefined) result.inventory = inventory(value.inventory, true);
	if (value.extras !== undefined) result.extras = inventory(value.extras, false);
	return result;
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

export function categories(value: unknown): Category[] {
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

export type * from './browser/types.js';
