# Frozen pre-conversion baseline

Captured 26 October 2026 from legends-walk commit
`6f23f79eca120623eca925f847cc74f62fbc0397`, using cross-doc commit
`1bbce1e845b1513fa1e10014617e3c1535315981` rebuilt from its unchanged production
source. The source project's Git status was clean before and after capture.
All 552 inventoried input files were hashed before rendering and rechecked afterward;
compilation ran against a temporary copy. No campaign files were modified.

## Inventory and diagnostics

| Item | Captured result |
| --- | --- |
| Entries | 464 |
| Categories | 7: 18 todo, 21 misc, 39 artefact, 97 event, 49 organisation, 212 person, 28 place |
| Themes | A5, book, card, personal, reduced; all compile to CSS |
| Figures | 27 images in 27 populated metadata arrays; 32 additional `figures: null` fields |
| Full-project diagnostics | 35 missing reciprocal links; zero missing targets or unused one-way declarations |
| Body links | 2,042 inline and 161 reference-style Markdown link occurrences |
| Reference definitions | 164, including unused definitions; counted separately from uses |
| Metadata references | 766 `also`, 144 `monoDirectionalLinks` |
| Body images / Wikilinks | No active body Markdown images or Wikilinks found in this legacy collection |
| Referenced resources | 28 active resources plus two dormant layout alternatives, explicitly flagged for review |
| Metadata shape paths | 38; per-shape examples are in `inventory.json` |

This supersedes the earlier plan's count of 34 reciprocal warnings. Do not edit content
just to bring it back to that count. Missing/reciprocal diagnostics for the selected
nine-note examples are recorded separately (118 each), because most target notes are
intentionally excluded. Those selected-output diagnostics are not full-project errors.

`inventory.json` contains every note's current/future path and identity, raw frontmatter,
parsed metadata, hashes, headings and discovered link occurrences. Top-level fields are
`title`, `type`, `also`, `monoDirectionalLinks`, `figures`, `alias`, `date`, `summary`,
`expandedIndex`, `pc` and `sheet`. Existing null arrays occur in `also`,
`monoDirectionalLinks`, `figures`, `alias` and `summary`; all current dates are YAML
timestamps. Alias entries include 98 strings and nine objects, with note/index/secret
variants. One character sheet exercises nested hero points, qualities and powers.
The synthetic fixtures cover missing/empty arrays, quoted dates, unknown metadata,
multiple figures, multiline captions, comments and duplicate basenames that are absent
from the current collection. Preserve the raw headers rather than writing parsed JSON
back to YAML.

`move-map.json` lists all 552 inputs, hashes, proposed moves and explicit review flags.
Filesystem metadata and generated CSS have no migration target. Two proposed attachment moves are flagged because their only references are in commented-out alternative cover layouts; they are not active rendering dependencies. Seven ordinary
unreferenced resources remain pending review; editable artwork is retained separately.
`Amarna.svg`, an unreferenced SVG, may have dependencies not reachable from a current
note: do not delete it based on this report. The reference inventory uses Markdown
parsing and HTML parsing for note links plus an audit scan of HTML/SCSS/SVG asset
attributes/URLs; Sass's loaded URL list supplies authoritative stylesheet imports.
Opaque artwork/native-package dependencies are flagged for manual review.

`legacy-links.example.json` is the complete proposed compatibility map (464 entry
aliases and 27 actual rendered figure IDs), not a placeholder example with invented
slugs. It conforms to the shape in the adjacent schema; uniqueness, target existence
and figure ranges are tested against the inventory.

## HTML and PDF evidence

`full-A5.html` is a structural HTML snapshot of all entries before selected-output
link removal. It deliberately retains legacy project-relative resource URLs and is
for DOM/content comparison, not standalone distribution. The five CSS snapshots and
`template-dependencies.json` preserve styles and Sass import paths/hashes.

The nine selected notes are `mordredii`, `sam`, `was`, `artie`,
`230310-gawain-in-london`, `2300313-boston`, `heb-sed-mace`, `todo-jotunheimr` and `satt`.
They cover player annotations and the character sheet, rich and secret aliases, private
content, an expanded index, dates/summaries/timeline, tables, figures and investigations.

- `output/pdf/A5/representative.pdf`: 21 pages, with cover, TOC, timeline and sheet.
- `output/pdf/reduced/representative.pdf`: 17 pages, hiding cover/timeline/sheet and
  `.private` text according to current CSS.
- Each directory also contains portable embedded HTML, extracted PDF text, `pdfinfo`
  and `pdffonts` output. `capture.json` records selection diagnostics and PDF hashes.

All 38 PDF pages were rendered with Poppler and inspected in contact sheets; detail
checks covered the TOC, figure captions, timeline and character sheet. Existing output
was preserved: Artie's source produces a repeated entry heading; large figures occupy
separate pages; the reduced report hides content visually but retains it in embedded
HTML. No new overlapping/clipped content was observed at review scale. This is a
baseline, not a redesign or a claim that the legacy output is free of defects.

Environment: Node 26.5.0, Prince 17 non-commercial license, Poppler 26.10.0, TZ=UTC.
Prince adds its non-commercial mark. Embedded PDF text fonts are Times New Roman
regular/bold/italic; the custom fonts in the source styles were not all available.
Future comparisons must distinguish font/environment changes from compiler regressions.
PDF binary hashes protect these captured files; do not use binary equality to judge
newly generated PDFs, whose timestamps/IDs can vary.

## Reproduce without overwriting the evidence

From the cross-doc package root, build with the pinned pnpm/TypeScript tools, then:

```sh
node scripts/capture-obsidian-baseline.mjs ../legends-walk /tmp/cross-doc-new-baseline
pnpm exec vitest run tests/obsidian-contract.test.mjs
```

Use a new empty destination; the script refuses to overwrite a previous capture. Prince,
`pdfinfo`, `pdftotext` and `pdffonts` must be on PATH. The live project is only read;
rendering uses a temporary copy that is removed even after failure. JSON manifests omit
machine-specific source roots, but PDF metadata/environment and tool versions can differ.
Compare source hashes, normalized HTML, relationships and rendering facts separately.
