// Browser-safe contracts. No publishing, HTML parser or Node imports.
export interface AliasDetails {
	name: string;
	note?: string;
	index?: string;
	secret?: boolean;
}
export type Alias = string | AliasDetails;
export interface Figure {
	file: string;
	caption: string;
}
export type QualityLevel = 'MSTR' | 'EXP' | 'GD' | 'AVG' | 'PR' | 'GO';
export interface Quality {
	id?: string;
	wounds?: number;
	name: string;
	value: QualityLevel;
	notes?: string;
}
export type Power = Quality;
export interface InventoryItem {
	id?: string;
	name: string;
	count: number | '∞' | null;
	value: number | null;
	location: string;
	capacity?: number;
	isExpanded?: boolean;
}
export interface CharacterSheet {
	id?: string;
	codeName?: string;
	avatar?: string;
	background?: string;
	bennies?: { current: number; max: number };
	inventory?: InventoryItem[];
	extras?: InventoryItem[];
	name: string;
	player: string;
	motivation: string;
	origin: string;
	heropoints: { current: number; max: number };
	qualities: Quality[];
	powers: Power[];
}
export type EntryDate = Date | string;
export interface FrontMatter {
	[key: string]: unknown;
	type: string;
	title: string;
	date?: EntryDate;
	pc?: string;
	alias?: Alias[];
	also?: string[];
	figures?: Figure[];
	summary?: string[];
	expandedIndex?: boolean;
	monoDirectionalLinks?: string[];
	sheet?: CharacterSheet;
}
export interface Category {
	[key: string]: unknown;
	category: string;
	heading: string;
	sort?: 'date' | 'title';
}

export interface ProjectPaths {
	entries: string;
	attachments: string;
	categories: string;
	layout: string;
	themes: string;
	legacyLinks?: string;
}
export interface VaultProjectConfig {
	version: 1;
	identity: 'vault-path-v1';
	paths: ProjectPaths & { legacyLinks: string };
}
