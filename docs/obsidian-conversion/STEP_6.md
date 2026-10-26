# Step 6 review: checked migration and disposable-copy rehearsal

Implemented and rehearsed without converting the live legends-walk repository.

## What to review

The public `planMigration`, `applyMigration` and `rollbackMigration` operations accept an
explicit move map, preserve exact original bytes in an external journal, and refuse
stale/unresolved/unsafe work. The repository CLI has separate plan/apply/rollback commands.
Planning writes only an external report; application checks the complete batch before
writes and attempts automatic rollback on failure. Rollback refuses later edits rather
than overwriting them. No original resource is removed merely because it is unreferenced.

Source changes use Markdown token offsets, HTML attribute/style locations and YAML CST
ranges. Only the figures key is removed from frontmatter. Captioned images append after
existing body/reference definitions; captions round-trip through the compiler parser.
Old relationships remain untouched and resolve through generated compatibility mappings.
Actual generated figure IDs, not filenames, determine the old-to-new figure map. Theme
category selectors are adapted explicitly; unrelated theme/confidentiality TODOs stay out
of this change.

The reviewable campaign result is 539 operations (537 moves and two generated config
files) and 2,298 edits:

| Edit                                 | Count |
| ------------------------------------ | ----: |
| Markdown inline destinations         | 2,042 |
| Reference-definition destinations    |   164 |
| Figures frontmatter removal          |    59 |
| Appended figure blocks               |    27 |
| Active/commented layout destinations |     4 |
| Theme category selectors             |     2 |

405 note headers remain byte-identical. Another 59 lose only the recorded figures range:
27 populated arrays become inline images and 32 null fields add no images. All attachment
bytes and note basenames, including unusual dated filenames, are preserved. The 31 move-map
review flags remain explicit: unreferenced/generated inputs stay in place; editable
originals/packages and dormant layout assets follow their reviewed moves. Legacy empty
folders and retained files are not silently archived or deleted.

## Rehearsal evidence

[Machine-readable verification](step-6-verification.json) records the completed run:

- 464 entries, 27 figures and 2,969 entry links in the full comparison; nine entries,
  four figures and 13 links in the representative selection. Mapped links/TOCs, aliases,
  header annotations, character sheets, timeline and captions compare successfully.
- All five themes compile. Their CSS matches the original after normalizing only the
  planned category-selector changes.
- Repeat planning produces zero operations. Rollback restores all 552 original file
  hashes/modes, then a second checked application leaves a converted disposable copy
  available for inspection. All 552 live input hashes remain unchanged and the live
  collection's Git status is clean.
- The converted collection has 944 diagnostics: the original 35 reciprocal warnings
  plus 909 expected compatibility notices for untouched legacy relationship values.
  Normalized non-compatibility diagnostics match exactly; there are no new missing or
  ambiguous targets.
- Actual A5/reduced representative PDFs contain 21/17 pages, matching the frozen
  baseline. All 38 pages were inspected after Poppler rendering. Figure pages, captions,
  drop caps, notes, TOC, timeline and sheet content remain present and legible.

The comparison retains the known improvement where Artie's source `Swords` heading replaces
legacy duplicate Artie header/aliases. It also exposed two compiler issues fixed here for
resolved/new-format entries: see-also labels concatenating secondary H1 headings, and empty
see-also blocks surviving selection. The latter initially added an almost-empty A5 page;
removing it restored the baseline page count. Legacy fragment-only HTML remains unchanged.

The final code's dry-run plan was checked against the completed rehearsal's plan and
matches exactly apart from the project root. Temporary review files are outside the vault:

- `/tmp/cross-doc-step6-review/`: the live project's **read-only** dry-run `REPORT.md` and
  `plan.json`. Do not apply this live-project plan as part of step 6.
- `/tmp/cross-doc-step6-rehearsal-final/`: before/after HTML/CSS, verification JSON, PDF
  checks, the disposable converted `project/`, and the `reapplied-journal/` rollback data.

These are temporary QA files, not committed duplicate campaign content. Regenerate them
with the commands below if the OS has removed them.

## Commands

Build first. The rehearsal command reads the live collection but applies only to its new
external copy; its output directory must not already exist:

```sh
pnpm run build
TZ=UTC pnpm run rehearse:obsidian -- --project ../legends-walk \
  --moves docs/obsidian-conversion/baseline/move-map.json \
  --output /tmp/new-obsidian-rehearsal --pdf
```

`--pdf` requires installed Prince and Poppler. Without it, semantic/theme/preservation,
repeatability and rollback checks still run. For manual plan/apply/rollback commands and
API details, see [the migration contract](../public-api.md#checked-obsidian-migration-step-6).
Use a disposable copy and new external report/journal directories when experimenting.

## Automated validation and boundaries

Library: 306 tests pass, including 48 new migration/CLI tests; five optional native tests
remain skipped in the default suite. Tests cover source preservation, CRLF/BOM, comments,
null/empty arrays, punctuation/multiline captions, reused/existing figures, nested Markdown,
reference definitions, raw HTML/styles, Sass/CSS/SVG dependencies, code preservation,
resource bytes, collisions, symlinks, stale inputs, failure recovery, rollback conflicts,
repeated planning and the actual CLI commands. CLI: 108 tests pass (two optional skipped).
GUI: 95 tests pass (one optional skipped). Builds, strict TypeScript, lint and formatting
checks pass; GUI retains its existing bundle-size advisory.

No dependencies/lockfiles changed. Adapter checks use refreshed library build snapshots
in existing local packages, as in preceding steps; offline Sass registry metadata still
prevents claiming clean-install/package/Electron validation. Public types remain in
`src/types.ts`.

The migrator deliberately blocks constructs it cannot preserve safely: ambiguous figures
comments/anchors, flow-style figures maps, unrepresentable captions, existing Wikilinks or
authored figure/heading references requiring an Obsidian authoring decision, raw HTML
figures, and byte-changing SVG dependency rewrites. Compiler support for both link formats
remains broader than this legacy-conversion subset. It is not an arbitrary vault/opaque
format converter, a concurrent-writer lock or an atomic multi-file operation. Journals
remain available for manual recovery if user edits or corrupt backups prevent rollback.

The real conversion and plugin symlink installation remain step 11. Step 7 builds the
plugin shell and desktop/mobile platform boundary.
