# Regression fixtures

Run `pnpm test`, `pnpm run test:watch`, or `pnpm run test:coverage`.
Vitest uses the Node environment and UTC for stable date output. Each pipeline
test copies the trusted fixture into its own temporary directory and removes it
afterward; source fixtures and the working directory receive no generated output.
The Node execFile boundary is mocked for routine output tests; filesystem writes, Markdown, YAML,
Cheerio, Sass, and base64 asset encoding remain real. Graph tests cover real DOT writes to temporary paths and mocked write failures.
EventEmitter tests verify walker errors reject without emitting uncaught errors.

`expected/document.html` is the full pre-upgrade output baseline. Review semantic
assertions and the known defects in `docs/public-api.md` before using
`pnpm exec vitest run --update`; do not silently preserve bugs or accept arbitrary
snapshot changes. `pnpm run test:package`
builds and packs the library, installs it into a temporary ESM consumer, checks
all root exports and a real fixture compilation, rejects private/CommonJS entry
points, and checks declarations with TypeScript 7 NodeNext. That consumer uses
fresh dependency resolution, while regression fixtures use the repository lock.
The upgraded Sass satisfies Vite's peer requirement. The new error/security tests
cover YAML resource limits and unsafe keys, metadata escaping, path traversal,
symlink escapes, safe process arguments, missing files and awaited graph writes.
All library source is checked TypeScript; Vitest loads .ts source while emitted
.js imports remain valid in Node consumers. Metadata/category validation cases
cover optional fields, wrong nested shapes, dates, enum values and unknown/duplicate
categories. The packed consumer imports every public type, proves key returns are
not any, and uses expected compiler errors to check invalid caller contracts.
Dependency declaration checking runs without skipLibCheck.

## Optional real PDF integration

Install Prince and Poppler (`pdfinfo`, `pdftotext`) on PATH, then run:

```sh
CROSS_DOC_TEST_PRINCE=1 pnpm exec vitest run tests/prince.test.mjs
```

`pnpm run test:pdf` runs the same opt-in check on POSIX shells. Normal test runs
skip it; explicitly opting in with missing tools must fail, not silently skip.
The fixture explicitly selects A4, fixed margins, and section page breaks. The
check verifies a real four-page PDF, A4 geometry, representative text, and the
expected map/events/sheet/timeline page placement.
Use a consistent Prince version and fonts when comparing pagination. Prince is
an external licensed tool and is not downloaded by the suite. Pixel-perfect
visual comparisons are not claimed by the automated PDF checks.

## Electron and Git distribution

`pnpm run test:electron` extends the packed consumer test with actual Electron
main/utility processes, error propagation and unpacked/ASAR app layouts. Set
CROSS_DOC_TEST_PRINCE=1 to include real PDF generation in every process/layout.
On headless Linux, use `xvfb-run --auto-servernum pnpm run test:electron`.
`pnpm run test:git` creates its own temporary Git repository and verifies the
source prepare/install workflow with permission limited to that exact commit.
See docs/validation.md for the environment and packaging boundaries.

Set CROSS_DOC_PDF_ARTIFACTS to retain a PDF and Poppler page PNGs from the optional
PDF test. The default remains temporary output with cleanup. Fixture table spacing
is explicit so visual review can assess readable character-sheet cells.

## Code-review item 7: structured diagnostics

Validated locally on 21 October 2026. The shared pipelines no longer print link
warnings; analyzeLinks returns stable code/severity/source/target records.
Successful results, onDiagnostics and CompilationError carry diagnostics. The
deprecated primitive retains its grouped stderr wrapper for compatibility.

- Library: 123 routine tests passed, two optional skipped. All 23 packed runtime
  exports and TypeScript declarations passed; unpacked/ASAR Electron consumers
  passed.
- CLI: 70 routine tests passed, two optional skipped, including injected-stream
  diagnostics before later failure and executable/subset behavior. Packed
  local/global installation and fixture compilation passed.
- GUI: 65 routine tests passed, one optional skipped. Oversized/invalid diagnostic
  payloads, omitted counts, renderer replacement/failure display and actual
  worker-to-preload success/failure transport passed. The extracted desktop ZIP
  passed standalone compilation, real Prince PDF and isolated preview checks.
- Types, lint and formatting passed in all packages. Full and production audits
  reported no known vulnerabilities in all three.
- Read-only Legends Walk inspection and actual Electron open/refresh showed 461
  entries and 47 diagnostics. Every displayed source/target matched the library
  records and legacy terminal report. No publishing into that checkout occurred.

No hosted CI, signing or publishing was performed.

## Code-review item 8: application policy and explicit graph output

Validated locally on 21 October 2026. writeGraph requires an explicit destination;
the deprecated generate_graph wrapper retains the test.dot fallback for 2.x,
scheduled for removal in the next major release. Normal compilation remains
graph-free. Theme/output defaults, CLI reporting and desktop policy remain in
their application adapters.

CLI reports use matching artifact kind/path phase facts alongside filesystem
observations. Unchanged files are not labelled Updated, completed artifacts
avoid false partial-file cautions after later failures, and changed files whose
phase was not started remain unverified. No atomicity or change-attribution
guarantee is implied.

125 library, 73 CLI and 65 GUI routine tests passed; five optional tests skipped.
Types, lint, formatting and full/production audits passed across all packages.
Packed library declarations/all 24 exports passed in Node and unpacked/ASAR
Electron. Packed CLI local/global installation and actual GUI Electron worker
smoke checks passed. A focused executable check confirms no default graph file
is generated during ordinary compilation. Hosted CI and distribution were not
run for this item; no GUI implementation change was needed.
