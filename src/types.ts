import type { FrontMatter, Category, ProjectPaths, Figure } from './browser/types.js';
export type * from './browser/types.js';
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
	/** Normalize source assets for portable publishing, including legacy layouts. */
	portableAssets?: boolean;
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

export interface HtmlPublication {
	path: string;
	format?: 'embedded' | 'linked';
	/** Linked HTML only; defaults beside the HTML as <basename>.assets. */
	assetsDirectory?: string;
}
export interface PdfPublication {
	path: string;
	princeBinary?: string;
}
export type PublicationOutputs =
	| { html: HtmlPublication; pdf?: PdfPublication }
	| { pdf: PdfPublication; html?: HtmlPublication };
export interface PublicationIntermediates {
	/** Parent for a unique, invocation-owned staging directory. Defaults to the OS temp directory. */
	directory?: string;
	/** Explicit intermediate file paths must not already exist. */
	cssFile?: string;
	htmlFile?: string;
	keep?: boolean;
}
export interface PublicationOptions extends ProjectOptions, LinkOptions {
	theme: string;
	outputs: PublicationOutputs;
	intermediates?: PublicationIntermediates;
	/** Existing deliverables are rejected unless explicitly enabled. */
	overwrite?: boolean;
}
export interface PublicationArtifact extends Omit<CompilationArtifact, 'kind'> {
	kind: CompilationArtifact['kind'] | 'assets' | 'intermediate-html';
	role?: 'deliverable' | 'intermediate';
	cleanup?: 'removed' | 'retained' | 'unverified';
}
export interface PublicationResult {
	diagnostics: readonly Diagnostic[];
	artifacts: readonly PublicationArtifact[];
}
export type RunStage = <T>(stage: CompilationStage, action: () => T | Promise<T>) => Promise<T>;
export interface PublicationDestination {
	path: string;
	directory: boolean;
	intermediate: boolean;
}
export interface PortableAsset {
	data: Buffer;
	mime: string;
	suffix: string;
}
export interface PublicationPaths {
	html?: string;
	pdf?: string;
	assets?: string;
	css?: string;
	intermediateHtml?: string;
}

export interface ResolvedPublicationDestination {
	destination: PublicationDestination;
	path: string;
}

export interface MigrationMove {
	source: string;
	target?: string;
	sha256?: string;
	review?: string;
}
export interface MigrationOptions extends ProjectOptions {
	moves: readonly MigrationMove[];
}
export interface MigrationIssue {
	severity: 'error' | 'review';
	code: string;
	source: string;
	message: string;
}
export interface MigrationPatch {
	start: number;
	end: number;
	text: string;
	kind: string;
}
export interface MigrationEdit {
	source: string;
	kind: string;
	start: number;
	end: number;
	before: string;
	after: string;
}
export interface MigrationInput {
	path: string;
	sha256: string;
	mode: number;
}
export interface MigrationOperation {
	source?: string;
	target: string;
	beforeSha256?: string;
	afterSha256: string;
	mode: number;
	/** Present for transformed UTF-8 files and new configuration; absent for byte-preserving moves. */
	contents?: string;
}
export interface MigrationFigure {
	source: string;
	target: string;
	ordinal: number;
	file: string;
	attachment: string;
	caption: string;
	markdown: string;
}
export interface MigrationPlan {
	version: 1;
	project: string;
	alreadyMigrated: boolean;
	inputs: MigrationInput[];
	operations: MigrationOperation[];
	edits: MigrationEdit[];
	figures: MigrationFigure[];
	legacyLinks: LegacyLinks;
	idMap: Record<string, string>;
	issues: MigrationIssue[];
	diagnostics: readonly Diagnostic[];
}
export interface MigrationApplyOptions {
	journalDirectory: string;
}
export interface MigrationJournal {
	version: 1;
	status: 'prepared' | 'applying' | 'applied' | 'rolling-back' | 'rolled-back';
	plan: MigrationPlan;
	createdDirectories: string[];
	temporaryFiles: MigrationTemporary[];
}
export interface MigrationResult {
	journalDirectory: string;
	status: 'applied' | 'rolled-back';
	files: number;
}
export interface MigrationProjection {
	text: string;
	offsets: number[];
}
export interface MigrationToken {
	type: string;
	raw: string;
	href?: string;
	tokens?: MigrationToken[];
	items?: MigrationToken[];
	header?: { tokens: MigrationToken[] }[];
	rows?: { tokens: MigrationToken[] }[][];
}
export type MigrationRewrite = (
	reference: string,
	kind: 'link' | 'image' | 'asset' | 'module',
	source: string,
	target: string,
) => string;
export interface MigrationSourceLocation {
	sourceCodeLocation?: {
		startOffset: number;
		endOffset: number;
		attrs?: Record<string, { startOffset: number; endOffset: number }>;
		startTag?: { endOffset: number };
		endTag?: { startOffset: number };
	} | null;
}
export interface MigrationHeader {
	bodyStart: number;
	figuresRange?: [number, number];
	figures: Figure[];
}
export interface MigrationTemporary {
	path: string;
	sha256: string;
}
