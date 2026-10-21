# Distribution and runtime validation

The modernization's seven implementation steps are complete. Verification was
performed locally on macOS on 21 October 2026. The GitHub workflows are configured
and will run after the changes are pushed; a remote CI run is not claimed here.

| Check                          | Result                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Fresh Node 24.22.0 checkout    | Frozen install, lint, formatting, strict types, 59 tests, build and packed consumer pass                                 |
| Fresh Node 26.12.0 checkout    | Same checks pass                                                                                                         |
| Published-package shape        | All 14 ESM operations and public types available; private/CommonJS imports rejected; stale artifacts and source excluded |
| Git SHA dependency             | Isolated Git source without dist prepares and installs successfully with explicit build permission                       |
| Electron 45.0.0 / Node 24.22.0 | Actual main and utility processes compile the packed fixture, verify exports, and propagate errors                       |
| ASAR layout                    | App and library code load from ASAR; production dependencies and writable project/output files remain outside            |
| External Prince 17             | Real PDF generation passes in Electron main/utility processes, unpacked and ASAR layouts                                 |
| PDF QA                         | Four A4 pages, expected page placement/text, embedded map and CSS checks; all page previews inspected                    |
| Security                       | Full and production pnpm audits both report zero findings, including Electron/ASAR tooling                               |

The document HTML baseline remains unchanged. The fixture theme gained spacing
for the character-sheet tables after visual review; source document rendering
behavior and the four-page baseline are preserved. The development-only Electron
and ASAR dependencies do not become runtime dependencies of cross-doc consumers.

## Automated checks

The Validate package workflow runs on pushes, pull requests, manual dispatch and
each Monday at 07:21 UTC. Node jobs cover the minimum supported 24.22.0 patch and
the newest Node 26 patch. They include frozen installs, quality checks, tests,
builds, packed/Git consumers, and full/production audits. Electron jobs run actual
main/utility and ASAR checks on Ubuntu (Xvfb) and macOS. No sandbox-disabling flags
are used. Binary installation is cached by Electron's official downloader.

On the ephemeral hosted Linux runner, the Electron job sets
`kernel.apparmor_restrict_unprivileged_userns=0` when that sysctl exists, allowing
Chromium to create its user-namespace sandbox. This relaxes the runner's AppArmor
restriction, not Electron's sandbox configuration; Electron runs as the normal
runner user without `--no-sandbox` or changes to the SUID helper's permissions.
Xvfb and the display dependencies remain required. The macOS and self-hosted PDF
jobs do not apply this Linux host-policy change.

This setup addresses the Ubuntu sandbox startup failure captured in `error.log`.
Hosted verification remains pending: both unpacked and ASAR checks must pass on
Ubuntu, and the macOS matrix job must continue to pass. If Ubuntu still aborts,
capture user-namespace and AppArmor diagnostics before changing the sandbox setup
further; local macOS results cannot verify Linux host policy.

Dependabot checks pnpm dependencies and GitHub Actions weekly. Minor/patch updates
are grouped by runtime/development dependency type; major updates remain separate
reviewable PRs, including future Electron major releases. Review updated behavior
and audit reports before merging. Keep packageManager and devEngines.packageManager
versions aligned when updating pnpm. Repository-level Dependabot alert/security
update settings remain under the repository owner's control.

## Running integration checks

```sh
pnpm run test:package
pnpm run test:git
pnpm run test:electron
CROSS_DOC_TEST_PRINCE=1 pnpm run test:electron
CROSS_DOC_PDF_ARTIFACTS=/tmp/cross-doc-pdf-review pnpm run test:pdf
```

Electron tests launch a temporary app without a renderer window. They intentionally
finish evaluating the ESM main entry before awaiting app readiness. The utility
process communicates only small results/errors through message ports. Both app
layouts import cross-doc through the installed package root. External Prince can
be selected with CROSS_DOC_PRINCE_BINARY for the Electron fixture.

For GUI integration, keep source projects, compiled CSS, HTML/PDF output and the
Prince executable at real, writable filesystem paths. ASAR is read-only and Prince
cannot resolve arbitrary virtual ASAR resource paths. The fixture places app and
library code inside the archive, leaving production dependencies outside; it does
not claim that every native dependency can execute inside ASAR without unpacking.

Real-PDF CI is opt-in because Prince is separately installed/licensed. Register a
self-hosted runner labelled prince with Prince and Poppler (pdfinfo, pdftotext,
pdftoppm) on PATH, and dispatch Validate package with pdf enabled. The job retains
PDF/PNG artifacts for visual review. The hosted Node/Electron jobs need no Prince
installation. Test code and the fixture have no external resource requirements.

The companion CLI and GUI migrations remain separate follow-up projects. Windows
integration is not covered by the present CI matrix.

## Category precedence sorting correction

Category index is now compared before any within-category date or title key.
Previously, two chronological categories separated by a title-sorted category
could violate comparator transitivity and produce reversed dates even within
one generated HTML category. Synthetic fixtures use the date arrangement from
the workspace review's Legends Walk adaptation; the real project is unchanged.

The new sorted-sequence and generated-HTML tests both failed before the fix.
They now pass, covering all 720 permutations of the mixed-category input,
equal-date title tie-breaking, title categories ignoring dates, stable equal
keys and preservation of the in-place array contract. Existing missing-date
validation and the reviewed document baseline remain passing.

Library types, lint, formatting, build and all 78 routine tests pass (one
optional test skipped). Both consumers were reinstalled with frozen lockfiles
to refresh the built local library snapshot: all 61 CLI and 53 GUI routine
tests pass, with their existing optional skips. No consumer source or lockfile
changes were needed. Packaged applications, hosted CI and real-Prince suites
were not rerun for this comparator-only correction.

## Excluded one-way-link target correction

Link analysis now retains actual outgoing targets and tracks monoDirectionalLinks
exemptions separately. Exemptions suppress only reciprocity requirements, so
missing targets still produce warnings and excluded targets lose their links
in subset output. Readable text/inline markup is preserved. An exemption on an
actually reciprocal edge no longer produces a false warning on the reverse edge.

Three new regression cases failed before the change: excluded-target removal,
missing-target reporting and the reciprocal-edge exemption case. All four new
cases now pass, including preservation of an included one-way target. Existing
absent-declaration diagnostics, ordinary link checks and the document baseline
also pass. A read-only, in-memory Legends Walk check confirms the investigation's
Eternal/Jaxom links are removed when excluded and Eternal's link is retained
when included; original project files were not changed or published into.

Library types, lint, formatting, build and 82 routine tests pass (one optional
skip). Consumers were reinstalled with frozen lockfiles to refresh the built
library snapshot. CLI types/lint and all 62 routine tests pass (two optional
skips); GUI types/lint and all 54 routine tests pass (one optional skip). New
consumer regressions publish subsets with a fake Prince and verify both normal
and embedded HTML remove excluded one-way links and retain included targets.
There are no dependency/lockfile changes. Real Prince, packaged Electron and
hosted checks were not rerun for this link-analysis correction.

## Distinct figure identifiers and numeric labels

Figures now have unique IDs across the processed entries. The first figure
keeps its legacy figure-<slug> ID where available; later figures receive numeric
suffixes that avoid entry IDs and reserved first-figure IDs. Synthetic tests
cover two figures in one entry, multiple entries, numbered-slug collisions in
both input orders, entry/figure collisions, unique TOC/reference targets and
numbering through 11. All four regressions failed before the correction.

Numbering uses numeric addition before string conversion, producing 1, 2, 3
instead of 01, 11, 21. Baselines in the library, CLI and GUI were changed only
at the three affected figure-number locations (caption, reference and TOC).
No snapshot regeneration or unrelated output change was made.

Library types/lint/build and 86 routine tests pass; the two optional Prince tests
also pass when enabled. The new real-PDF regression verifies reference and TOC
links point to distinct pages containing their respective figure captions.
Both consumers were reinstalled with frozen lockfiles to refresh the library;
CLI types/lint and all 62 routine tests pass, as do GUI types/lint and all 54
routine tests, with their existing optional skips. No dependencies changed.

A separate temporary adaptation used the real Ares/Ptah source and existing
vision-mountain.png from Legends Walk, adding the two illustrative captions
from the action plan. HTML retained figure-ares-ptah and added
figure-ares-ptah-2. Prince/Poppler confirmed the references and TOC links point
to pages 3 and 4 containing the respective captions. The original project was
read-only, and private content/artwork were not committed. Packaged Electron
and hosted CI checks were not rerun for this library-only behavior change.

## Strict explicit include validation before output

The additive public select_files helper validates a complete discovered file
list against an optional explicit include selection. Omitted include selects
all; explicit empty/blank, duplicate and unknown selections reject, reporting
all unknown names. It preserves discovery order. Existing get_files permissive
filtering remains unchanged and has explicit compatibility regression coverage.
The public export inventory now contains 15 operations and packed declarations
include the new helper.

CLI and GUI utility compilation discover all files and run the same helper
before reading/generating document output. CLI unknown-only, mixed and duplicate
selection regressions failed before the correction. New regressions prove CSS,
HTML, PDF and embedded output retain their original bytes and Prince is never
invoked on selection failure. GUI coverage includes a selected file removed
since refresh; the main/preload validators remain independently enforced.

Local types/lint and routine suites pass: 95 library tests, 67 CLI tests and
59 GUI tests, with existing optional skips. Frozen consumer reinstalls refreshed
the built library. The packed ESM consumer/export and TypeScript declaration
checks pass. A temporary project containing the real Legends Walk Father is
Pleased source compiled with its actual slug (2300311-father-is-pleased); the
misspelling (230311-father-is-pleased) failed alone and alongside hyde-formula,
leaving all pre-existing outputs unchanged. The original project was read-only.
No dependencies or lockfiles changed. Real Prince and hosted CI checks were
not rerun for this discovery/validation change.

## Shared project preparation and compilation

Added loadProject and compileProject as additive root APIs, plus CompilationError
and typed progress/artifact contracts. Preparation performs strict discovery and
selection, read/parse/clean/metadata/link processing and validated sorting without
writing CSS/output or requiring Prince. Compilation reuses it and owns the
render/placeholders/TOC/title/output sequence. No application defaults, Electron
code or automatic graph generation were introduced.

Tests verify unchanged reviewed HTML, write-free refresh, strict selection before
writes, structured ordered progress, awaited Prince completion and original error
causes. Failures expose stage/artifact snapshots: not-started means no attempt by
this invocation, unverified allows partial/old/missing files, and completed means
the relevant write phase resolved. Tests explicitly preserve old files across
selection, render and output failures. This is not an atomic-output guarantee.

CLI delegates to the shared compiler while retaining progress wording, path/flag
policy, exit codes and filesystem-based file reports. GUI refresh/publish uses
the shared loader/compiler, retaining its snapshots, theme checks, sessions,
workers, settings and PDF viewer. Full/subset consumer tests compare output bytes
against direct shared compilation with identical project/theme/path options.
The original 15 function exports remain; there are now 17 operations plus the
CompilationError class. Project inspection and diagnostic presentation remain
separate unfinished action-plan items.

Local types/lint and routine suites pass: 101 library tests, 69 CLI tests and
61 GUI tests, with optional skips unchanged. Packed library export/declaration
checks pass for all 18 runtime exports. CLI packed/local/global executable checks
pass. Both real-Prince library tests pass. Actual Electron smoke, React Fast
Refresh/Node restart checks and extracted macOS arm64 ZIP tests pass, including
real Prince PDF generation/preview. Both full and production audits are clean
for all three packages. There are no dependency or lockfile changes.

Consumers were reinstalled from the rebuilt sibling with frozen lockfiles.
Deploy library changes before migrating consumers in hosted CI, which intentionally
checks latest sibling master. Hosted/Linux execution remains pending; local
macOS results do not establish it. The unsigned review ZIP was rebuilt locally.

## Shared project inspection and domain validation

Added public readCategories, inspectProject, listThemes and validateTheme APIs
(21 operations plus CompilationError: 22 runtime exports). LoadedProject includes
validated categories and themes. Shared compilation consumes the same category
snapshot for sorting, HTML generation and TOC construction; a regression changes
categories.json after sorting and confirms the original snapshot is used later.
Standalone primitive APIs continue validating their own category input.

Theme discovery matches the established immediate-directory/index.scss contract
and deterministic ordering. Symlinked directories are omitted, while index.scss
symlinks to regular files are accepted. Missing themes do not prevent loading;
a selected removed/unknown/invalid theme fails before any output write attempt.
This is not a filesystem sandbox for trusted Sass input. Existing known-slug
selection validation remains shared and independent of transport policy.

GUI refresh now maps categories and themes directly from loadProject. Duplicate
JSON parsing and filesystem theme discovery were removed from the GUI utility;
renderer/main/preload summaries, IPC guards and budgets remain GUI-owned.

Local types/lint and routine suites pass: 121 library tests, 69 CLI tests and
61 GUI tests, with existing optional skips. New tests cover public category
validation, synthetic Legends Walk theme names, malformed categories, symlink
policy, missing/removed themes, no-write loading and snapshot consistency.
Read-only inspection of Legends Walk agrees with loading: 461 entries, seven
categories and A5/book/card/personal/reduced themes. Original files are unchanged.

Packed library declarations/exports and CLI local/global package checks pass.
Both real-Prince library tests, actual Electron smoke and extracted macOS arm64
ZIP checks pass, including real PDF generation/preview. Full and production
audits for all three packages report zero findings. Consumer snapshots were
refreshed using frozen installs; no dependencies or lockfiles changed. Hosted
CI/Linux validation remains pending, and the unsigned local ZIP was rebuilt.
