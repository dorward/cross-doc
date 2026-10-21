import type { CheerioAPI } from 'cheerio';

export type HtmlDocument = CheerioAPI;
export interface ProjectOptions {
	project: string;
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
}
export interface OutputOptions extends ProjectOptions {
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
	| 'discover'
	| 'read'
	| 'parse'
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
	code: 'unused-one-way-link' | 'missing-link-target' | 'missing-reciprocal-link';
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
