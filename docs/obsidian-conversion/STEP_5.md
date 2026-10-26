# Step 5 review: selectable, portable publishing

Implemented through additive `publishProject`; the live collection remains unchanged.

## Behavior to review

- Explicit `outputs` selects PDF, HTML or both. HTML defaults to embedded/self-contained
  output and never probes or invokes Prince. Linked HTML copies CSS/images/attachments
  into a companion directory and rewrites URLs. Copies use content-derived filenames,
  deduplicate repeated resources, and preserve resource fragments and image queries.
  CSS/SVG local dependencies remain embedded within copied files.
- PDF-only leaves the requested PDF in its destination. CSS and print-input HTML use
  unique temporary staging by default, or explicit intermediate paths. Cleanup runs on
  success/failure; optional retention supports debugging. Intermediate phase and cleanup
  facts are distinct from deliverable completion.
- Source protection checks configured roots, publishing inputs, artwork/drafts and
  Obsidian/Git paths, including existing symlink ancestors. A dedicated export directory
  within the project is allowed. Overlapping/portable-colliding destinations, existing
  intermediates, unsafe symlinks/hard links and invalid file kinds reject. Deliverables
  require explicit overwrite when already present. Unrelated companion/parent files
  remain intact. Output ancestors are rechecked before writing; intermediate aliases
  are pinned before cleanup.
- HTML/asset/PDF completion is tracked individually. A later PDF failure retains completed
  HTML facts and reports attempted PDF as unverified. Causes, diagnostics and cleanup
  outcomes survive `CompilationError`. Missing/empty PDF output cannot report success.
- Legacy `compileProject` retains its signature, three-output artifact contract, progress,
  implicit CSS location and output behavior. Both APIs share preparation, HTML rendering
  primitives and the extracted Prince invocation. CLI/GUI continue using that contract;
  only the CLI's error-artifact type widens to accept additive publication kinds.

See [public API examples and semantics](../public-api.md#selectable-publication-outputs-step-5).

## Validation evidence

- Library: 258 tests pass; five optional native tests are skipped by default. The new
  43-test publishing suite covers format combinations, default HTML without Prince,
  PDF-only cleanup, relocation after removing source, linked assets/CSS, encoded paths,
  fragments/queries, retained/removed intermediates, partial failures, stale outputs,
  invalid destinations, source containment, symlinks/hard links, portable collisions,
  overwrite behavior and aliases changed during rendering.
- CLI: 108 tests pass; two optional checks skipped. GUI: 95 tests pass; one optional
  check skipped. Builds, strict TypeScript, lint and formatting checks pass. GUI retains
  its existing large-bundle advisory. Public export inventories and the package consumer
  type fixture include the additive API.
- A separate real Prince check passes. PDF-only export produces no permanent HTML/CSS
  in its destination. Linked HTML and its companion folder are relocated, the source
  vault is hidden, and Prince renders the relocated HTML with its figure and navigation
  intact. The resulting single page was visually inspected after Poppler rendering.
  Temporary QA files are outside the source tree.
- The 464-entry campaign still reports 35 diagnostics. Full A5 HTML is byte-identical
  to the frozen baseline, all 552 input hashes match and legends-walk Git status is clean.

No dependencies or lockfiles changed. As in preceding steps, adapter integration uses
refreshed built-library snapshots in existing local packages because offline Sass 1.106.1
metadata prevents a fresh installation. Clean-install/package/Electron validation is not
claimed. All new project-owned type definitions are in `src/types.ts`.

## Boundaries

Publication is not atomic and provides no rollback: an attempted PDF can be empty/partial
on failure, including after an explicitly allowed overwrite. Temporary cleanup is reported
separately. Existing unrelated companion files are not pruned. Remote dependencies and
arbitrary script-driven/compound resources remain outside the supported asset subset.
Current CLI/GUI retain their existing format controls; plugin export UI, overwrite prompts,
worker/cancellation behavior and preventing concurrent jobs belong to later steps.

Step 6 builds and rehearses the migration tool. No campaign content was migrated, and no
plugin or vault installation was performed here.
