# Stage 12 — end-to-end acceptance and usage documentation

Stage 11 is accepted. Stage 12's available headless checks and documentation are
complete; native Obsidian, GUI-window and OS/version/device acceptance remains
explicitly pending in [the manual checklist](../../../cross-doc-obsidian/MANUAL_TESTING_STEP_12.md).
No Obsidian application or native GUI was launched or controlled.

## Publishing correction found during acceptance

The full real-vault HTML export produced its file but failed to return the large
diagnostic report: the child disconnected before its final IPC send completed.
`desktop/worker.ts` now waits for the final send callback before disconnecting,
including failure replies. Progress remains asynchronous. A regression test
holds send callbacks pending with a large reply and proves disconnect waits;
the real standalone Node 20.18 export now successfully delivers all 944 diagnostics.

Concurrent build/installer tests also exposed shared-distribution writes: a reader
could see another test's unfinished bundle. Test files now run serially because
those tests intentionally share the development `dist/`. Retry remains disabled,
and all existing strict checks and 100% per-file coverage remain enforced.
All project-owned type definitions remain in `src/types.ts`.

## Automated evidence

The installed development symlink was used to load the packaged desktop adapter.
Its compiler ran in the separate installed Node.js **20.18.0** executable, with
real **Prince 17**, on macOS. The library/CLI/GUI backend ran under Node **26.5.0**.
All three adapter dependency snapshots were refreshed from the current library
build before testing. The symlink remains installed and repeated installation
reports `unchanged`.

- Catalog/inspection agrees across plugin, library, CLI and GUI backend: 464 notes
  and all five themes. Plugin catalog validation reports no invalid notes.
- Real full-vault embedded HTML completes with 464 entries, 27 figures and the
  expected 35 reciprocal warnings plus 909 legacy-reference notices.
- Representative selection is the nine entries listed in the manual checklist.
  Plugin A5/reduced combined exports, PDF-only, embedded HTML, relocated linked
  HTML and HTML-only with a nonexistent Prince path all succeed.
- Book, card and personal HTML also succeed, covering every theme. This checks
  the current theme behavior; it does not resolve existing theme/privacy TODOs.
- Six real PDFs were generated. A5 outputs from plugin, PDF-only mode, library,
  CLI and GUI backend are 21 pages each, with identical extracted text and all
  rendered page pixels matching. Reduced has 17 pages.
- All 38 distinct A5/reduced page images match the previously visually reviewed
  baseline. Fresh character-sheet, event and contents pages were also inspected.
  Times New Roman regular/bold/italic are embedded; decorative font families were
  not added or substituted in source. The installed noncommercial Prince license
  can display its mark. Fonts and license differences affect reproducibility.
- Representative HTML content, entry links, figures and timeline agree across
  plugin/library/CLI/GUI backend. Linked HTML and its companion assets survive
  relocation outside the vault, with local referenced files verified.
- Exporting leaves all 557 scanned vault files byte-identical. The README was
  intentionally updated afterward as this stage's documentation change; authoring
  notes, frontmatter, publishing configuration and attachments were not changed.

Strict checks/builds pass. Library: **323 tests pass**, five optional native tests
skipped. Plugin: **343 tests pass**, 100% coverage in 59 runtime/build/tooling files.
CLI: **108 tests pass**, two optional tests skipped. GUI: **95 tests pass**, one
optional test skipped. GUI retains the existing large-bundle advisory. These checks
do not establish native Windows/Linux, Electron-window or mobile behavior.

See [machine-readable evidence](step-12-verification.json). Detailed reports,
source-preservation assertions, output comparisons, actual PDFs/HTML, page PNGs,
font lists and check logs are retained outside the vault at:

```text
/Users/david/prog/cross-doc/.acceptance/stage-12/
```

`verify.mjs` records the one-off headless run; the accepted outputs are internal
QA artifacts. `exports.log` records the discovered failure, and
`exports-retry.log` records successful completion after the fix. The final plugin
bundle includes the corrected publishing worker and updated in-app help.

## Documentation and rollout boundaries

The [vault README](../../../legends-walk/README.md) now documents folder roles,
inline Markdown/Wikilinks and headings, single-line link labels, inline figures,
field meanings/help, category editing, rename repair, development symlinks and
five-file distribution, desktop Node/Prince setup, output formats/destinations,
themes, confidentiality behavior, font families/installation, adapter commands,
supported runtime boundaries and reverse-order recovery.

The [plugin README](../../../cross-doc-obsidian/README.md) and in-app help now
describe the implemented feature set rather than future stages. The workspace
TODO retains confidentiality policy, card/book behavior, reciprocal warnings,
retained resources and a portable-font/fallback decision. Font installation is
documented; no theme redesign, font download or confidentiality change was made.

| Acceptance area              | Current evidence                                                                 | Remaining review                                          |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Obsidian 1.14.4 API baseline | Manifest, public API host doubles and strict types                               | Run actual 1.14.4 application                             |
| Newer Obsidian versions      | Minimum-version contract                                                         | Record and test exact newer release                       |
| macOS publishing             | Real installed symlink/Node/Prince, all formats and adapter parity               | Native editor/export-dialog interactions                  |
| Windows/Linux Obsidian       | Platform-gating/runtime-path tests                                               | Native editing and export on each OS                      |
| iOS/iPadOS/Android           | Mobile bundle rejects Node/Electron imports; desktop UI capability tests         | Device editing/help/undo/repair and hidden export UI      |
| Cross-doc GUI                | Build/tests and real compiler-backend output parity                              | Actual GUI window, selection, bridge and artifact actions |
| Fonts                        | Exact source-family inventory, embedded-font report, matching current-host pages | Review substitutions/layout on other publishing machines  |

Stage 12 stays open until the intended native matrix is accepted or specific rows
are explicitly deferred with their limitations recorded. Follow the manual guide
in a disposable vault for destructive/error/rename exercises; retain all migration
and follow-up journals until rollout acceptance.
