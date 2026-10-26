# Step 2 review: configured layouts and path identities

Implemented without reorganizing legends-walk or changing its source files.

## Behavior to review

- Public `resolveProjectLayout` auto-detects `publishing/project.json` or accepts
  explicit root-relative `configFile`. Configurations validate exact keys/version,
  path safety, file kinds, real-path containment, root overlaps and config placement.
  Missing automatic configuration retains the legacy layout; malformed/present or
  missing explicit configuration fails without fallback.
- Public `indexProject` returns serializable layout, full entry inventory and validated
  compatibility mappings. V1 IDs derive from the entire vault-relative path, including
  `notes/`; duplicate basenames in different folders work. Portable case/Unicode
  collisions, entry symlinks, duplicate/stale map keys and invalid figure ordinals fail.
- Shared loading indexes the complete V1 collection before explicit selection. Legacy
  aliases normalize selection and relationship values without rewriting YAML. Duplicate
  alias/canonical selections reject. Legacy body entry/figure fragments receive the
  appropriate namespaced targets; deprecated entry aliases produce `legacy-reference`
  warnings. No unrecorded basename guessing is performed.
- Configured categories, layout, themes and figure attachments are threaded through
  inspection/loading/rendering. Entry/category/figure/sheet IDs and generated TOC,
  timeline, title and graph targets use the frozen codec. CSS goes beside the selected
  HTML destination, including external directories, and is explicitly registered for
  embedding; source attachment containment remains enforced. Legacy output snapshots
  and progress sequences remain unchanged.
- CLI adds `--config-file` and supports canonical includes in inspection/compilation.
  GUI refresh/selection uses canonical identifiers and shows paths beside titles;
  bounded IPC accepts configured inspection/index progress and alias diagnostics.

The [public API documentation](../public-api.md#configurable-vault-layouts-and-identities-step-2)
records new types, optional primitive contexts and CSS output handling. New runtime
files are `src/layout.ts`, `src/project_index.ts` and `src/compatibility.ts`.

## Validation evidence

- Library: 130 existing tests plus 22 configured-layout tests pass (152 total);
  two existing opt-in tests remain skipped. The final focused run covers all 22 new
  tests, including the frozen escaping vectors and external CSS destinations.
- CLI: 106 tests pass; two opt-in tests skipped. New executable-level inspection tests
  cover custom config paths, duplicate basenames, canonical selection, alias/canonical
  duplicate rejection and no source writes.
- GUI: 91 tests pass; one opt-in test skipped. New tests cover configured refresh and
  selected publication, path labels, indexed progress sequencing and diagnostic guards.
- Library/CLI/GUI builds, strict TypeScript checks, Oxlint and Oxfmt checks pass.
  GUI build retains its existing large-chunk advisory; no runtime/build failure.
- Real legends-walk still loads as a legacy project: 464 entries, five themes, 35
  reciprocal warnings, zero missing-target warnings. All 552 frozen source hashes
  match and the collection's Git status is clean.

The CLI/GUI lockfiles still describe their previously installed library dependencies.
An offline dependency refresh could not resolve the library's declared Sass 1.106.1
from the local registry metadata (which lists 1.106.0). Dependency versions and lockfiles
were left unchanged. Integration validation refreshed only the built cross-doc `dist/`
inside the existing local package snapshots; the normal pnpm symlinks were restored.
Full clean-install/package/Electron smoke validation is not claimed here; repeat that
when the declared dependency is available. No new dependencies were introduced.

## Boundaries for subsequent steps

This is the layout/identity foundation, not the actual Obsidian conversion. Step 3
adds ordinary file links, Wikilinks, heading indexes and richer target diagnostics;
step 4 adds inline figures/attachment authoring; step 5 adds selectable publishing
formats and portable companion-asset packaging. Step 2's figure-map ordinal validation
counts existing metadata figures and must be extended when step 4 adds inline figures.

The actual migration must adapt category-specific theme selectors such as `#event`
to the namespaced category IDs (prefer `[data-category="event"]`) in addition to moving
asset references. Keep this in the move/patch manifest and compare PDFs under the same
fonts/Prince version; no existing templates were changed as part of this implementation.
