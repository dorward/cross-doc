# Step 1: frozen migration contracts

These are the proposed v1 contracts for steps 2–12, not implemented runtime APIs.
The source collection remains untouched. See `baseline/README.md` for capture evidence.

## Layout and configuration

Open `legends-walk/` as the vault. Use the exact configuration in
`project.example.json`, installed later as `publishing/project.json`. The accompanying
`project.schema.json` is Draft 2020-12. Unknown keys, wrong versions and unsafe
relative paths fail validation. All paths are vault-root-relative, never relative
to the JSON file or the invocation directory. No machine paths, output directory,
Prince executable or per-user preferences belong in this shared file.

Discovery: an explicit `configFile` option selects one root-relative configuration
file. Otherwise inspect exactly `publishing/project.json`; if absent, use the existing
legacy layout and identity rules. A present but invalid configuration fails: never
silently fall back. Filesystem validation additionally rejects escaping symlinks,
wrong file/directory kinds, overlapping entry/attachment/theme roots, and config/layout
files within the entry collection. Schemas describe JSON shape; index-aware invariants
below require runtime checks. Configuration/version changes are explicit migrations.
Only lowercase `.md` files recursively under `notes/` are entries; ignore dot directories
and reject entry symlinks in the new layout to keep identity independent of realpaths.
Attachments can use internal symlinks only if their resolved files remain in the vault.
Do not compile root documents, drafts, publishing inputs or export directories.

| Current path                                                    | Proposed path                       | Preservation rule                                                          |
| --------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `data/people`, `events`, `organisations`, `places`, `artefacts` | same category folder under `notes/` | Keep note basenames and metadata category IDs.                             |
| `data/misc`                                                     | `notes/reference`                   | Category remains `misc`.                                                   |
| `data/TODO`                                                     | `notes/investigations`              | Category remains `todo`.                                                   |
| `data/categories.json`                                          | `publishing/categories.json`        | Exact bytes.                                                               |
| `templates/index.html`                                          | `publishing/layout.html`            | Change only planned asset/CSS destinations.                                |
| `templates/<theme>`                                             | `publishing/themes/<theme>`         | Keep theme names and cross-theme imports; update moved asset destinations. |
| `resources/*` used as attachments                               | `attachments/*`                     | Preserve resource-relative names and file hashes.                          |
| editable originals in `resources/*`                             | `artwork/sources/*`                 | Preserve bytes; linked originals stay attachments.                         |
| `cover/*`                                                       | `artwork/covers/*`                  | Preserve bytes.                                                            |
| `report.md`                                                     | `drafts/report.md`                  | Preserve bytes; not compiled.                                              |
| generated `out/*`, `TEST.pdf`, `test.dot`, compiled CSS         | no input destination                | Retain for review; do not automatically delete/archive.                    |

The capture's `move-map.json` expands this table to individual source files.
Reference inventory determines attachment relevance; extensions alone do not.
Native formats with opaque dependencies and unreferenced files receive explicit
review flags rather than assumed deletions. Output destinations are chosen per export.

## Identity and HTML IDs: vault-path-v1

Canonical identity is the logical POSIX path relative to the vault root with only
its final lowercase `.md` removed. Example: `notes/people/artie.md` →
`notes/people/artie`. Preserve case and Unicode code points. The `notes/` prefix
is included. Reject empty/dot/parent segments, absolute/drive paths, backslashes,
control characters and paths outside the configured entry root. No trimming,
lowercasing, title matching or replacement of slashes with hyphens is permitted.
Two notes with the same basename in different folders are valid.

Reject case-folded or NFC-normalized path collisions for portable vaults; report both
source paths without renaming either. Logical identity never incorporates an absolute
machine path, a symlink realpath, the vault directory's name, or an output directory.

The reversible codec is `encodeURIComponent` on **each identity segment**, joined
with `/`. Thus whitespace and `%` are escaped in the actual HTML ID. Namespace IDs:

- entry: `entry/<encoded identity>`
- sheet: `sheet/<encoded identity>`
- figure: `figure/<encoded identity>/<1-based figure ordinal within that note>`
- heading: `heading/<encoded identity>/<encoded heading text>/<1-based occurrence>`
- category: `category/<encoded category ID>`

Figure ordinals are source-order ordinals, independent of compiled document-wide caption
numbers. Heading text is parser-extracted plain text (entities decoded, inline markup
removed), preserving case/Unicode with surrounding whitespace trimmed and internal
whitespace collapsed to one ASCII space. Repeated identical headings receive occurrence
numbers. Lookup maps Obsidian heading text to this index; ambiguous heading links fail
with candidates rather than selecting an occurrence implicitly. Entry title links target
the entry ID. No note path can collide with another namespace.

To build an href, URI-encode **each HTML-ID segment** again and prepend `#`.
Internal DOM lookups, title annotation and graph/TOC consumers must URI-decode the fragment once before exact ID matching; never apply that decoding to the canonical filesystem path.
This second layer intentionally escapes literal percent signs in the HTML ID; decoding
the URL fragment once must recover the exact DOM ID. It is not accidental double-encoding
of the original note path. Always HTML-escape the attribute when serializing.
`identity-vectors.json` specifies expected paths, identities, DOM IDs, hrefs and
collision cases for later implementation tests. Browser and PDF fragment navigation
must be tested as well as string equality. JSON config paths are filesystem paths,
not URL strings; never URI-decode them.

## Compatibility map

`legacy-links.schema.json` defines `publishing/legacy-links.json`. `entries` binds
an old slug to one canonical note identity; `figures` binds the actual old generated
figure DOM ID to the owner identity and its 1-based source ordinal. Capture the rendered
legacy figure IDs rather than guessing their suffixes. Empty arrays are allowed.
Do not automatically infer mappings for notes created after migration.

Runtime invariants: unique `legacySlug`/`legacyId` keys, existing target identities,
valid figure ordinals, safe-integer ordinals, and no legacy key that means something
different when interpreted as a canonical identity. Reject duplicate keys even when
they repeat the same target. Multiple distinct legacy aliases may bind to one target.
Figure IDs and entry aliases are separate namespaces; links identify which namespace
is intended. Diagnose stale mappings rather than reassigning them by basename.

Normalize `also`, `monoDirectionalLinks`, legacy body fragments and include values
through this explicit map; then operate only on canonical identities. Preserve every
existing relationship scalar during migration. New/explicitly edited relationship
values use canonical identities. Moving a note updates mapping targets and canonical
metadata references; it does not give its old slug to a newly created same-named note.
Optional legacy output anchors are emitted only when globally collision-free; record
skipped aliases. Existing ordinary Markdown paths/Wikilinks resolve through path lookup,
not through metadata alias shortcuts.

## Proposed API delta (additive, versioned)

| Surface                           | Contract for implementation                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectOptions`                  | Add optional `configFile`; `project` remains vault/project root.                                                                                                                                                                                                                                                    |
| `resolveProjectLayout(options)`   | New async public operation; validate config and filesystem; return serializable normalized root-relative layout plus identity mode.                                                                                                                                                                                 |
| `indexProject(options)`           | New async public operation; index all entries before selection, validate mappings/collisions and expose path/identity lookup data. No rendering/writes.                                                                                                                                                             |
| `loadProject` / `compileProject`  | Resolve layout/index once, select canonical identities, then thread the same context through parsing, metadata and rendering. Legacy projects keep basename identities.                                                                                                                                             |
| `ParsedEntry` / `Entry`           | Preserve `slug`; it equals canonical identity for v1 projects. Add optional root-relative `vaultPath`; existing absolute `path` remains for legacy callers.                                                                                                                                                         |
| standalone `parse_data`           | Keep no-context behavior; accept an optional validated identity context for v1 callers. Do not derive new IDs from arbitrary absolute input paths.                                                                                                                                                                  |
| `select_files`                    | Retain old signature; optional validated index context enables canonical selection. Reject duplicates after alias normalization.                                                                                                                                                                                    |
| categories/themes/HTML primitives | Accept optional resolved context while retaining legacy signatures; no private deep imports for adapters.                                                                                                                                                                                                           |
| diagnostics                       | Add stable `ambiguous-link-target`, `unsupported-link-syntax`, `missing-heading-target`, `non-published-link-target`, `excluded-link-target`, `legacy-reference` codes; preserve current codes for legacy calls. Path source/target strings use canonical IDs in v1. Config/index failures throw with source paths. |
| progress                          | Add `inspect`, `index`, `resolve` stages; retain ordering guarantees for existing stages and document callbacks. Update all adapters and public unions.                                                                                                                                                             |
| new publishing API                | Add `publishProject(options, hooks?)` with a discriminated `outputs` object selecting `pdf`, `html`, or both. `html` selects `embedded` (default) or `linked` and a destination; PDF supplies destination and optional Prince path. At least one output required.                                                   |
| `compileProject` compatibility    | Preserve required three-output behavior; delegate to shared internals. Existing callers do not change their expected artifacts or implicit defaults.                                                                                                                                                                |
| output result/error               | Extend artifact kinds for asset directories/intermediates where exposed; use existing completed/unverified/not-started semantics, preserve causes and diagnostics. Generated CSS goes to output/staging in the new publishing API, never publishing source folders.                                                 |

`publishProject` takes explicit project/theme/output paths and optional includes;
UI defaults/choosers remain in adapters. Output protection rejects collision with source
files/directories after symlink resolution; a dedicated sibling export folder is allowed.
HTML-only never preflights Prince. Worker messages contain validated serializable options,
progress, diagnostics and artifact facts; no native objects. Editor code stays browser-safe;
desktop publishing modules are loaded only on desktop. Plugin-owned declarations remain
in `cross-doc-obsidian/src/types.ts`.

## Preservation and review assertions

1. Freeze hashes of every note, raw frontmatter block, resource and template before conversion.
2. After conversion, strip only the original `figures` source range when comparing
   frontmatter; all other bytes, unknown fields, YAML comments/quoting, null arrays,
   dates and nested sheet/alias values remain unchanged. Ambiguous comment ownership fails
   preflight for manual review. Preserve bodies except planned link rewrites/figure appends.
3. Every original figure has one inline replacement at the note end, original relative
   order, identical decoded caption and attachment bytes; no duplicated rendered figure.
4. Every old relationship resolves to the same logical owner through the recorded map.
   Compare full and selected entry links, metadata links, figures, sheets, headings,
   category/TOC targets and figure counts through explicit old/new output ID mappings.
5. Validate every actual metadata shape, including absent/null/empty arrays, simple and
   rich aliases, secret flags, expanded indexes, date representations, summaries, player
   annotations, figures and the nested character sheet. `baseline/inventory.json` records
   concrete examples and per-note raw headers; fixtures must cover synthetic cases not
   present in legends-walk (especially multiple figures and duplicate basenames).
6. Second migration is empty; rollback restores hashes. No unexplained diagnostics,
   truncated captions, missing assets or added metadata. Existing 35 reciprocal warnings
   are a recorded baseline, not newly waived failures.
7. Baseline PDF quirks are evidence, not a request to redesign existing themes. Compare
   the same Prince version, fonts, timezone and selection; classify expected ID/path changes
   separately from content/layout regressions. Never use PDF binary equality as a layout test.
