# Public API baseline

The ESM-only root barrel exports 23 named operations and CompilationError, plus all the public types
below. All library source is strict TypeScript 7; declarations are emitted from
checked implementations. No source files or private deep imports are required.
CLI and GUI callers can compose operations in the order demonstrated by
`tests/helpers.mjs`, and import types with `import type { Entry } from 'cross-doc'`.

| Export                        | Arguments                                     | Result                                                                            |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| get_files                     | Options                                       | Promise of Markdown path array                                                    |
| select_files                  | Discovered file paths, optional include slugs | Validated selected paths; rejects empty, duplicate or unknown explicit selections |
| read                          | filename                                      | Promise of UTF-8 string                                                           |
| read_files                    | filename array                                | Promise of RawDocument array                                                      |
| parse_data                    | RawDocument array                             | ParsedEntry array                                                                 |
| clean_html                    | ParsedEntry array                             | Entry array with normalized headings/index metadata                               |
| add_front_matter              | Entry array, Options                          | Entry array with rendered metadata                                                |
| warn_missing_reciprocal_links | Entry array, Options                          | void; reports diagnostics and may remove excluded links                           |
| sort                          | Options                                       | Promise of object with sort(Entry[]): Entry[]; sorts in place                     |
| generate_html                 | Entry array, Options                          | Promise of Cheerio document; also writes compiled CSS                             |
| replace_placeholders          | Cheerio document                              | void; mutates document                                                            |
| add_table_of_contents         | Cheerio document, Options                     | Promise of void; mutates document                                                 |
| add_title_attributes          | Cheerio document                              | void; mutates document                                                            |
| generate_graph                | Cheerio document, Entry array, Options        | Promise of void; writes graph_file_name or test.dot in cwd                        |
| output                        | Cheerio document, OutputOptions               | Promise of void; writes HTML/PDF/embedded HTML                                    |

Exported public types:

- ProjectOptions: required project directory. LinkOptions: optional readonly include
  array of slugs. GraphOptions: optional graph_file_name.
- Options: combines project/link/graph options with an optional theme.
  GenerateHtmlOptions requires both project and theme.
- OutputOptions: project plus html_file_name, pdf_file_name, embedded_html_file_name,
  and optional prince_binary executable path. Options may also set graph_file_name.
- RawDocument: path and UTF-8 contents. HtmlDocument aliases CheerioAPI.
- ParsedEntry/Entry: path, slug, type/category, title, source content, rendered html,
  optional date, aliases, see-also slugs, figures, summaries, expanded index,
  monoDirectionalLinks, and character-sheet data. Custom top-level metadata remains
  available as unknown; callers must narrow extension fields before use.
- Category: category ID, heading, optional sort mode ('date' or 'title').
- Alias: string or AliasDetails with required name and optional note/index/secret.
  Figure: file and caption.
- CharacterSheet: name, player, motivation, origin, hero point counts, qualities
  and powers. Quality and Power have name, QualityLevel value ('MSTR', 'EXP',
  'GD', 'AVG', 'PR', 'GO') and optional notes. Hero point values are nonnegative
  safe integers. EntryDate is Date | string (valid ISO dates at runtime).

Unquoted YAML timestamps arrive as Date values; quoted ISO dates remain strings.
Both are validated and rendered by Moment. The regression fixture fixes TZ=UTC; additional timezone policy should
be deliberate during input validation work. The library is for Node-capable
processes; the GUI calls it through narrow IPC operations rather than importing
filesystem/process functionality into its sandboxed renderer.

Sorting preserves the category order in categories.json. Within each category,
chronological entries use ascending date with title as a tie-break; other
categories use title order. Equal sort keys retain their input order. Sorting
continues to mutate and return the supplied array, and chronological entries
without dates are rejected.

For application compilation with an explicit selection, first discover the full
file list using `get_files({ project })`, then call `select_files(files, include)`
before reading or generating output. Omitted include selects all files; explicit
empty/duplicate selections reject and every unknown slug is reported. Selection
preserves discovery order. The existing `get_files` filter remains permissive,
including empty results for unknown slugs or an empty include array.

## Runtime validation

YAML type/title, category IDs/headings and provided text values must be nonempty
strings. Optional arrays must be arrays of their documented element types, not
null or scalars. Alias secret and expandedIndex must be booleans; figures require
file/caption; character sheets require all documented fields, recognized quality
levels and valid hero points. Date values must be finite Date objects or valid
ISO strings. Unknown category IDs, duplicate category IDs, invalid JSON, unsupported
sort modes and missing dates in chronological sorting reject with diagnostics.
Top-level metadata/category extension fields are retained as unknown, subject to
unsafe-key and nesting checks. Invalid inputs no longer reach rendering through
unchecked JSON.parse/YAML values. TypeScript checking does not replace these
runtime checks. Public function types describe valid caller-supplied objects;
validation of imported YAML and category JSON is shared across the pipeline.

## Error and security behavior

Missing reads, walker errors, invalid includes, parser/metadata failures,
renderer failures and graph writes now reject/throw; library code does not exit
the host process. Graph links to missing nodes report the source and target.
The DOT serializer escapes IDs/labels and awaits its output write.

YAML uses the maintained yaml package with timestamp support, duplicate-key
checks, a 1 MiB header limit, alias-expansion limits, a nesting limit, and unsafe
key rejection. Required type/title values must be nonempty strings. Derived
path/slug/html fields cannot be overwritten by front matter. Smart punctuation
and heading IDs use supported Marked extensions; raw parsed punctuation may be
represented as numeric HTML entities, with unchanged rendered text/output.

Metadata interpolation is escaped. Selected output removes secret aliases from
both visible alias text and index metadata. One-way link declarations suppress
only missing-reciprocal warnings: missing targets are still reported, and links
to excluded targets are removed from selected output while retaining their text. Fragment lookups use exact ID
matching, not arbitrary CSS selectors. External links are ignored by reciprocal
link and graph checks. Asset embedding validates project containment, including
symlinks, before invoking Prince; external and existing data links are preserved.
Prince is called using an argument array, with no shell and no network access.

Markdown/raw HTML, SCSS, templates and caller-supplied options remain trusted
inputs, not a sandboxed untrusted-project interface. Local file access by Sass
and Prince is not isolated. See README for the trust boundary.

## Figure identifiers and references

Generated figures use distinct fragment IDs across entries. The first figure
keeps `figure-<slug>` when that ID is available; later figures use numbered
suffixes, skipping IDs reserved for other entries or their first figures.
Caption numbers and references are consecutive document-wide integers starting
at 1. Table-of-contents links use the same figure targets.

## Remaining output quirks

- Automatically derived title attributes on category/figure links can be
  concatenated or empty.

The trusted fixture's expected HTML was captured with the original Babel-era
source/dependencies. It still passes unchanged after the runtime migration;
additional tests cover the deliberate error/security corrections above.

## Shared project pipeline

`loadProject(options, hooks?)` accepts project and optional include slugs and
returns `{ entries, categories, themes, diagnostics }` after discovery, strict selection validation, reading,
parsing, cleaning, metadata, link checking, category validation and sorting.
It does not generate CSS, write document outputs or invoke Prince, so GUI
refresh can use the same preparation as publishing.

`compileProject(options, hooks?)` requires project, theme and all three output
filenames, with optional include/prince_binary. It prepares entries, generates
HTML/CSS, replaces placeholders, builds the TOC, adds title attributes and awaits
all output. There are no implicit application theme/output defaults or graph
side effects. The original primitive APIs remain available.

Both APIs accept synchronous `onProgress({ stage, status })` through the second
argument. Status is started/completed. Stages are discover, read, parse, clean,
metadata, links, sort, render, placeholders, toc, titles and output; loadProject
stops after sort. Progress is structured, without terminal wording. Callback
exceptions abort the pipeline. Neither pipeline writes link diagnostics to stderr.

Successful compilation returns `{ artifacts, diagnostics }`, with absolute paths and kinds
css/html/pdf/embedded-html. `CompilationError` preserves the original message
and cause, reports its failed stage and contains a snapshot of artifact facts:

- not-started: this invocation did not attempt that artifact; an old file may exist.
- unverified: a write phase was attempted but did not finish successfully; the
  file may be old, newly written, partial or missing.
- completed: the relevant write phase resolved in this invocation. This does
  not distinguish creation from replacement of an existing file.

CSS is tracked around HTML generation. The three document files are conservatively
unverified together if output rejects, because the legacy output API does not
expose individual write completion. These statuses are not an atomic-output or
rollback guarantee. Preparation errors have an empty artifact list. Applications
retain filesystem inspection and presentation appropriate to their own UI.

Public types include CompilationStage, PipelineHooks, LoadedProject,
CompilationOptions, CompilationArtifact and CompilationResult.

## Project inspection and theme validation

`readCategories(project)` exports the existing validated category loader,
including category order, sort mode and permitted extension fields.
`listThemes(project)` returns sorted immediate template-directory names containing
a regular-file index.scss. Missing templates or no matching directories yields
an empty list; other filesystem errors reject. Symlinked theme directories are
ignored, matching the established GUI behavior. An index.scss symlink to a
regular file is accepted. Sass imports/filesystem access remain trusted input.

`inspectProject(project)` returns `{ categories, themes }`, also exposed through
LoadedProject / ProjectInspection. `validateTheme(theme, available)` returns a
valid available name or throws; it rejects empty names, dot/parent segments,
NUL and slash/backslash separators. It does not choose a default theme.

A shared compilation uses one validated category snapshot for sorting, HTML
categories and TOC construction, even if categories.json subsequently changes.
Standalone sort/generate_html/add_table_of_contents calls still validate their
own category input. Compilation and standalone HTML generation validate the
chosen theme against current discovery before writing CSS. A missing theme does
not prevent loading/refreshing a project, but publishing with it rejects.

The GUI maps library categories to its own bounded serializable summaries.
Its independent payload guards, theme/slug authorization and message limits
remain application concerns and do not become library transport policy.

## Link diagnostics

`analyzeLinks(entries, options)` returns `Diagnostic[]` without printing. Like the
legacy primitive, it unwraps missing target links when include is nonempty,
preserves their contents, ignores external/figure links and rejects duplicate
slugs. It is not a pure function when selected-output transformation is enabled.

Each diagnostic has a stable code, severity `warning`, source slug and target:
`missing-link-target`, `missing-reciprocal-link` or `unused-one-way-link`.
An include selection reports targets absent from the selection, including targets
which may exist in the full project. Warnings do not fail compilation.

Both pipelines return diagnostics and accept synchronous
`onDiagnostics(diagnostics)`, called once after link analysis (including an empty
batch), before sorting or output. The callback receives copied records; later
pipeline failures retain diagnostics in `CompilationError.diagnostics`. Errors
before link analysis have no diagnostics. Callback exceptions abort the pipeline.

`warn_missing_reciprocal_links` is deprecated in favor of the analyzer or shared
pipelines. It remains exported, returns void and retains its grouped stderr
wording and selected-output transformation in 2.x. Removal requires a future
breaking release; applications should own formatting and stream selection.

## Explicit graph output and application policy

`writeGraph(htmlDocument, { graph_file_name })` requires a nonempty destination
and returns Promise<void>. Relative destinations resolve against the caller's
working directory through the filesystem, as with the legacy writer. It writes
the same DOT format, awaits writes and propagates validation/filesystem errors.
There is no default destination and no graph side effect in loadProject or
compileProject.

`generate_graph(htmlDocument, entries, options?)` is deprecated in favor of
writeGraph. Its unused entries parameter and missing/empty-name fallback to
`test.dot` in cwd remain supported in 2.x. The fallback is scheduled for removal
in the next major release, not silently changed in this additive migration.

The library reports artifact paths and phase status, not human-readable file
reports or whether a pre-existing file changed. CLI before/after inspection and
wording remain in the CLI. Theme selection, output basenames, native chooser,
Prince discovery/preferences, GUI selection state, IPC and preview remain in
their application adapters. compileProject continues to require explicit theme
and HTML/PDF/embedded-HTML destinations and does not impose GUI out/auto defaults.
