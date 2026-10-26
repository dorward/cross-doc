import type { CheerioAPI } from 'cheerio';

export type HtmlDocument = CheerioAPI;
export interface ProjectOptions {
	project: string;
	configFile?: string;
}
export interface LinkOptions {
	include?: readonly string[];
}
export interface GraphOutputOptions {
	graph_file_name: string;
}
/** Legacy graph options; use GraphOutputOptions for explicit output. */
export interface GraphOptions {
	graph_file_name?: string;
}
export interface Options extends ProjectOptions, LinkOptions, GraphOptions {
	theme?: string;
}
export interface GenerateHtmlOptions extends ProjectOptions {
	theme: string;
	css_file_name?: string;
}
export interface OutputOptions extends ProjectOptions {
	css_file_name?: string;
	html_file_name: string;
	pdf_file_name: string;
	embedded_html_file_name: string;
	prince_binary?: string;
}
export interface RawDocument {
	path: string;
	contents: string;
}
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
	name: string;
	value: QualityLevel;
	notes?: string;
}
export type Power = Quality;
export interface CharacterSheet {
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
export interface ParsedEntry extends FrontMatter {
	path: string;
	slug: string;
	vaultPath?: string;
	linkResolution?: boolean;
	linkReferences?: LinkReference[];
	__content: string;
	html: string;
}
export type Entry = ParsedEntry;
export interface Category {
	[key: string]: unknown;
	category: string;
	heading: string;
	sort?: 'date' | 'title';
}

export type CompilationStage =
	| 'inspect'
	| 'index'
	| 'discover'
	| 'read'
	| 'parse'
	| 'resolve'
	| 'clean'
	| 'metadata'
	| 'links'
	| 'sort'
	| 'render'
	| 'placeholders'
	| 'toc'
	| 'titles'
	| 'output';
export interface Diagnostic {
	code:
		| 'unused-one-way-link'
		| 'missing-link-target'
		| 'missing-reciprocal-link'
		| 'legacy-reference'
		| 'ambiguous-link-target'
		| 'unsupported-link-syntax'
		| 'missing-heading-target'
		| 'non-published-link-target'
		| 'excluded-link-target';
	candidates?: string[];
	severity: 'warning';
	source: string;
	target: string;
}
export interface PipelineHooks {
	onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
	onProgress?: (event: { stage: CompilationStage; status: 'started' | 'completed' }) => void;
}
export interface ProjectInspection {
	categories: Category[];
	themes: string[];
}
export interface LoadedProject extends ProjectInspection {
	layout?: ResolvedProjectLayout;
	index?: ProjectIndex;
	diagnostics: readonly Diagnostic[];
	entries: Entry[];
}
export interface CompilationOptions extends GenerateHtmlOptions, OutputOptions, LinkOptions {}
export interface CompilationArtifact {
	kind: 'css' | 'html' | 'pdf' | 'embedded-html';
	path: string;
	// These describe this invocation, not whether a destination previously existed.
	status: 'not-started' | 'unverified' | 'completed';
}
export interface CompilationResult {
	diagnostics: readonly Diagnostic[];
	artifacts: readonly CompilationArtifact[];
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
export interface ResolvedProjectLayout {
	project: string;
	identity: 'legacy' | 'vault-path-v1';
	configFile?: string;
	paths: ProjectPaths;
}
export interface IndexedEntry {
	path: string;
	vaultPath: string;
	identity: string;
	id: string;
}
export interface LegacyEntryLink {
	legacySlug: string;
	target: string;
}
export interface LegacyFigureLink {
	legacyId: string;
	target: string;
	ordinal: number;
}
export interface LegacyLinks {
	version: 1;
	entries: LegacyEntryLink[];
	figures: LegacyFigureLink[];
}
export interface ProjectIndex {
	layout: ResolvedProjectLayout;
	entries: IndexedEntry[];
	legacyLinks: LegacyLinks;
}

export interface HeadingRecord {
	owner: string;
	text: string;
	trail: string[];
	occurrence: number;
	level: number;
	id: string;
	legacyId?: string;
}
export interface AnchorRecord {
	owner: string;
	original: string;
	id: string;
	occurrence: number;
}
export interface LinkReference {
	target: string;
	kind: 'entry' | 'heading' | 'figure' | 'local';
	status: 'resolved' | 'missing' | 'excluded';
}
export type LinkResolution =
	| { kind: 'entry' | 'heading' | 'figure' | 'local'; href: string; target: string }
	| { kind: 'attachment' | 'external'; href: string }
	| {
			kind:
				| 'missing'
				| 'ambiguous'
				| 'unsupported'
				| 'non-published'
				| 'excluded'
				| 'missing-heading';
			target: string;
			owner?: string;
			referenceKind?: LinkReference['kind'];
			candidates?: string[];
	  };
export interface ResolvedLinks {
	entries: ParsedEntry[];
	diagnostics: Diagnostic[];
	headings: HeadingRecord[];
}
export interface LinkResolutionContext {
	index: ProjectIndex;
	headings: HeadingRecord[];
	anchors: AnchorRecord[];
	published: ReadonlySet<string>;
	figureCounts: ReadonlyMap<string, number>;
	lookup: (path: string) => Promise<'file' | 'missing' | 'unsafe'>;
	attachmentPaths: () => Promise<string[]>;
}

export interface HeadingIndex {
	entries: ParsedEntry[];
	headings: HeadingRecord[];
	anchors: AnchorRecord[];
}

/** Internal validated asset and its output-independent references. */
export interface AssetReference {
	path: string;
	href: string;
	data: string;
}
export interface CssSourceMap {
	mappings: string;
	sources: string[];
	sourceRoot?: string;
}
export interface CssUrl {
	start: number;
	end: number;
	value: string;
}

export type FigureId = (slug: string, index: number) => string;
