# Obsidian conversion: step 1 review package

Step 1 is implemented; runtime compiler changes and the campaign migration have not
started. Review the following artifacts before implementing step 2:

- [Frozen contracts](CONTRACT.md): project layout, folder moves, identity/HTML-ID codec,
  compatibility rules, public API changes and preservation assertions.
- [Project configuration schema](project.schema.json) and [concrete configuration](project.example.json).
- [Legacy-map schema](legacy-links.schema.json) and [complete proposed campaign map](baseline/legacy-links.example.json).
- [Identity/fragment vectors](identity-vectors.json): same basenames in different folders,
  ambiguous flattened paths, percent escapes, Unicode, spaces and portability collisions.
- [Baseline report](baseline/README.md): input inventory, warning counts, source hashes,
  full-project HTML, styles/dependencies and representative A5/reduced PDF captures.
- [Move manifest](baseline/move-map.json): one entry for every inventoried source file,
  with explicit review flags for unreferenced artwork, dormant layouts and generated files.
- [Synthetic source fixture](../../tests/fixtures/obsidian-contract/edge-cases.md) and
  [additional cases](../../tests/fixtures/obsidian-contract/cases.json): metadata and
  collision cases not represented by the current campaign.

From the cross-doc package root, `pnpm run test:obsidian-contract` validates the capture
and reference vectors. The normal package suite also includes these tests. The tests
verify the frozen specification, not an implementation of the future resolver or migration.
`pnpm run capture:obsidian-baseline -- ../legends-walk /tmp/new-baseline` creates a
separate capture; the destination must be empty. See the baseline report for tools and
comparison limits. Do not run a formatter over captured HTML/CSS/PDF evidence; the
baseline directory is deliberately excluded from Oxfmt.

Validation at completion: the library TypeScript check and formatting/lint checks pass;
130 tests pass and two opt-in tests are skipped. Both representative PDFs were generated
with the installed Prince, and all 38 pages were inspected after Poppler rendering.
All 552 campaign input hashes remain unchanged and legends-walk's Git status stays clean.
