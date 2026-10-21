# Dependency and tooling upgrade plan

Prepared 21 October 2026. All seven implementation steps are complete. Local validation results and CI execution boundaries are recorded in docs/validation.md. Runtime dependencies have been upgraded and vulnerable wrappers replaced.

## Recommended direction

Use Node 24 LTS as the minimum supported runtime, TypeScript 7 as the compiler and type checker, Oxlint for linting, and Oxfmt for formatting. Use pnpm for development, dependency management, packaging, and CI. Remove Babel and create-index. Ship native ES modules only. cross-doc-cli and cross-doc-gui will be updated afterwards; their existing implementations and old Electron versions do not constrain this upgrade. No CommonJS build or legacy compatibility layer is required. Replace small legacy wrappers with Node APIs where that removes vulnerable dependency trees.

Node 26 is currently the newest release line but is still Current; test it in CI alongside Node 24 rather than making it the minimum immediately. See the [Node release table](https://nodejs.org/en/about/previous-releases).

## Electron integration contract

Target the latest stable Electron release, currently **45.0.0** (verified through npm); refresh and pin the exact stable version used for implementation and CI. The [Electron release table](https://releases.electronjs.org/) lists Node 24.22.0 for this release, consistent with the Node 24 baseline. Choose emitted JavaScript syntax and Node APIs supported by both the minimum standalone Node runtime and Electron's bundled Node runtime.

cross-doc remains a Node library without a runtime dependency on Electron. Its filesystem and child-process functionality belongs in Electron's main process or a dedicated Node-capable utility process. Use a utility process to keep document compilation and parsing off the UI thread. The GUI should expose narrow compilation operations through validated IPC and contextBridge while retaining renderer sandboxing and context isolation. Do not expose the library wholesale to renderer JavaScript. See [Electron's ESM process distinctions](https://www.electronjs.org/docs/latest/tutorial/esm) and [sandbox guidance](https://www.electronjs.org/docs/latest/tutorial/sandbox).

Publish every intended library operation as a named export from the package root, together with its public TypeScript types. Maintain the existing named operations unless a documented API correction is needed; avoid private deep-import requirements. Provide an ESM usage example for a CLI and a minimal Electron consumer fixture. Both must import the packed package, not source files. The later companion-app updates are separate work and do not block completion here.

Electron validation must exercise actual Electron, not just standalone Node: import the package, enumerate public exports, and run the document fixture in a Node-capable process. Include a utility-process smoke test for compilation and error propagation. Validate filesystem/resource paths and the external Prince executable in a packaged Electron fixture, including ASAR boundaries where applicable. Pin the Electron test version for reproducibility and refresh it through dependency updates.

## Initial findings from this repository

- The library has 14 implementation modules plus a generated public barrel. There is no TypeScript configuration or TypeScript dependency.
- `npm test` always fails with “no test specified”; there are no checked-in example projects or CI workflows. Build output is not checked in.
- `build` runs `create-index -r ./src` and Babel into `dist`. `main` points to `dist/index.js`.
- Babel uses preset-env targeting Electron 9. With the default module transform in this CLI setup it converts ES module syntax to CommonJS and lowers syntax for that old target. There is no active JSX plugin or special Babel transform to preserve.
- `useBuiltIns: 'entry'` and `corejs: 3` are configured, but source files contain no core-js entry import and core-js is not a direct dependency. Do not assume Babel currently supplies runtime polyfills.
- `package.json` uses `type: "script"`, which is not a valid explicit Node module type; replace it with `module`.
- Current source uses removed/deprecated APIs: Cheerio's default export, Marked's smartypants/smartLists options, and Sass `renderSync`.
- `read.js` resolves even when a read fails; `get_files.js` lacks a stream error handler; parser failures call `process.exit()` without a failure status; PDF errors are logged and swallowed. These need explicit failure behavior during migration.

## Verified version targets

Queried npm's registry using `npm outdated --json` and `npm view`. Versions are a dated snapshot; refresh before implementation and commit the exact resolutions in pnpm-lock.yaml after the package-manager migration. “Current” below is the package.json range, not necessarily the locked version.

| Package                                    | Current range | Latest stable checked | Plan                                                                                        |
| ------------------------------------------ | ------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| cheerio                                    | ^1.0.0-rc.12  | 1.2.0                 | Upgrade; use named `load` import                                                            |
| marked                                     | ^4.1.0        | 18.1.1                | Upgrade; migrate options and compare output                                                 |
| sass                                       | ^1.54.9       | 1.106.0               | Upgrade; use `compile` or `compileAsync`                                                    |
| moment                                     | ^2.29.1       | 2.31.0                | Upgrade first; retain date behavior                                                         |
| klaw                                       | ^4.0.1        | 4.1.0                 | Upgrade; add error handling                                                                 |
| prince                                     | ^1.8.6        | 1.14.8                | Inspect latest dependency tree; prefer direct executable adapter if vulnerable tree remains |
| datauri                                    | ^4.1.0        | 4.1.0                 | Replace: latest still pins affected image-size                                              |
| yaml-front-matter                          | ^4.1.1        | 4.1.1                 | Replace if fresh resolution cannot provide a clean YAML parser                              |
| fs-readfile-promise                        | ^3.0.1        | 3.0.1                 | Replace with node:fs/promises.readFile                                                      |
| read-file                                  | ^0.2.0        | 0.2.0                 | Replace with node:fs/promises.readFile                                                      |
| write                                      | ^2.0.0        | 2.0.0                 | Replace with mkdir({ recursive: true }) and writeFile; preserve directory creation          |
| graphviz                                   | ^0.0.9        | 0.0.9                 | Evaluate replacement with small, properly escaped DOT serializer                            |
| vitest                                     | absent        | 5.0.5                 | Added with matching @vitest/coverage-v8                                                     |
| typescript                                 | absent        | 7.0.2                 | Add                                                                                         |
| oxlint                                     | absent        | 1.89.0                | Add; remove ESLint and eslint-plugin-import                                                 |
| oxfmt                                      | absent        | 0.74.0                | Add                                                                                         |
| @babel/cli, @babel/core, @babel/preset-env | 7.x           | Removal planned       | Remove after replacement build passes                                                       |
| create-index                               | ^2.6.0        | Removal planned       | Keep an explicit public barrel                                                              |

Marked's checked release requires Node >=20, covered by the Node 24 baseline. Avoid replacing Moment in the first upgrade: ordinal dates (`Do MMMM YYYY`), YAML date coercion, timezone behavior, and sorting all need to remain stable. A later Intl-based replacement is possible but does not need to block security fixes.

## Security baseline and remediation

`npm audit --package-lock-only --json` reports **33 affected packages: 4 critical, 18 high, 10 moderate, 1 low**. Counts include transitive packages and propagated findings; they do not establish that all issues are exploitable through this library.

The critical package entries are @babel/traverse, form-data, request, and tar. Installed Prince depends on request 2.88.2 and tar 6.1.11. Removing Babel addresses its build-time subtree; replacing or repairing the Prince wrapper addresses its installer/runtime subtree. Do not use `npm audit fix --force` as the migration strategy.

Specific actions:

1. Remove Babel, create-index, ESLint and their obsolete transitive trees as their replacements land.
2. Replace datauri with file reads, Buffer base64 encoding, and a maintained MIME lookup (or a documented MIME mapping for supported asset types). Its latest 4.1.0 pins image-size 1.0.0; audit's proposed downgrade to 1.1.0 is not the recommended fix. See the [image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr).
3. Inspect prince@1.14.8's actual resolved dependencies before retaining it. If still affected, call a separately installed, maintained Prince binary using execFile/spawn with an argument array. Preserve the current timeout and output limits, reject on failure, and document installation and licensing. Review the executable version separately: npm audit does not cover it. Keep the same PDF renderer to avoid introducing pagination changes unnecessarily.
4. Replace yaml-front-matter with a maintained YAML parser plus a tested front-matter adapter if an upgrade cannot resolve its js-yaml issues. Preserve `__content`, date values, mandatory fields, and error behavior; set parser resource limits and reject unsafe object keys. Do not blindly override a major parser version beneath the old wrapper.
5. Upgrade Moment to 2.31.0 and Sass to the checked stable release; resolve remaining transitive findings through supported parent upgrades or replacements.
6. Review content handling beyond advisories: front-matter values are interpolated into HTML, Markdown permits raw HTML, selectors are built from hrefs, and embedding treats every non-fragment href as a local asset. Escape metadata, distinguish external links from local resources, and enforce project-root containment for assets. Define and document whether Markdown/templates are trusted; sanitize untrusted HTML with an explicit policy and constrain renderer access to external resources where applicable.
7. Re-run full and production-only audits against the new lockfile. Track any residual issue with its dependency path, reachability, and concrete remediation; do not declare the work complete while unresolved security findings remain.

## Ordered implementation batches

### 1. Migrate package management to pnpm

Status: implemented with pnpm 12.14.0, an imported pnpm-lock.yaml, npm devEngines enforcement, a package-manager/lockfile CI check, and reviewed dependency build-script settings. Clean frozen installation and the existing Babel build pass on Node 26.5.0. npm 11.17.0 rejects install, ci, and run in a disposable checkout without changing project files. CI targets Node 24; its remote run is pending. Security remediation and the test suite remain in later steps.

- Select the latest stable pnpm compatible with the Node baseline, verify its current configuration requirements, and pin its exact version in package.json's `packageManager` field. Document installation and use the same version in CI.
- Run `pnpm import` against the existing package-lock.json to establish the initial pnpm-lock.yaml before dependency upgrades. Then remove package-lock.json, reinstall from a clean node_modules using pnpm, and commit only pnpm-lock.yaml. See [pnpm import](https://pnpm.io/cli/import).
- Add `devEngines.packageManager: { "name": "pnpm", "onFail": "error" }` to package.json. Modern npm checks devEngines before install, ci, and run commands, so accidental npm usage in this checkout fails instead of silently creating a second dependency tree. The `packageManager` field alone is not sufficient enforcement. See [npm devEngines documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#devengines).
- Verify the guard with the supported npm version: npm install, npm ci, and npm run build must exit nonzero with a package-manager error; pnpm install and pnpm run build must work. Test in a disposable checkout and confirm the failed commands leave package manifests and lockfiles unchanged. The guard applies to repository development, not to consumers installing the published library as a dependency.
- Document that this prevents accidental use on supported tooling, not deliberate bypasses such as --force or npm versions that do not implement devEngines. Avoid the deprecated only-allow package and an npx-based preinstall download; use the built-in guard. See [only-allow's deprecation notice](https://github.com/pnpm/only-allow).
- Convert README instructions, project scripts that invoke npm, CI installs/caches, security checks, and packaging to pnpm equivalents. Use `pnpm install --frozen-lockfile` in CI and reject accidental package-lock.json/yarn.lock additions. Historical npm audit/version-query evidence in this plan remains as the pre-migration baseline.
- Keep pnpm's strict dependency resolution; declare missing direct dependencies rather than enabling broad hoisting. Review required dependency build scripts, including the Electron test binary download, and allow only the specific necessary builds using the pinned pnpm version's configuration.

### 2. Establish compatibility and regression fixtures

Status: implemented. Vitest 5.0.5 runs 18 routine tests; one opt-in real-Prince test passes with installed Prince 17 and Poppler. Trusted temporary-project fixtures cover the complete HTML/embedded-asset pipeline, graphs, error cases, and a reviewed HTML baseline. The baseline also matches Babel-built output in an isolated temporary project. Public operations and intended types are recorded in docs/public-api.md; legacy error and formatting defects are characterized, not fixed here. CI now runs Vitest. Application source and existing runtime dependency versions are unchanged. Vite reports an optional Sass peer mismatch against the old application Sass; tests bypass Vite CSS processing, and the Sass upgrade remains in step 4.

- Record the intended public exports from src/index.js and define the ESM API and types that the later CLI/GUI updates will consume. Existing companion implementations are reference material, not compatibility requirements.
- Add a small complete fixture project: categories, Markdown/front matter, aliases, dates, reciprocal links, figures, character sheets, template, SCSS, and embedded assets.
- Use Vitest to verify parsing, heading changes, TOC ordering, cross-reference replacement, HTML generation, and embedded HTML. Include missing files, malformed YAML, invalid metadata, missing graph targets, and renderer failures.
- Capture representative output before dependency changes in an isolated worktree/environment. Do not run old vulnerable tooling on untrusted input. If the old build cannot run, document that and use reviewed fixture expectations.
- Configure Vitest for the Node environment and add test/watch/coverage scripts. Use Vitest mocks for the Prince process in routine tests; include an optional real-Prince integration check for PDF text, page count, and representative layout.

### 3. Set runtime and package contract; replace Babel

Status: implemented. Node 24.22.0 is pinned for development/CI. TypeScript 7.0.2 builds native ESM, inferred declarations, and source maps from the existing JavaScript using NodeNext/ES2023; full checked source conversion remains step 6. The explicit public barrel is maintained by hand. Babel, its configuration, and create-index are removed. Package exports allow root ESM imports and types only; prepare builds support packing and Git installs. A temporary packed consumer verifies all 14 operations, fixture compilation, declaration resolution, clean output, and private/CommonJS rejection. Native YAML interop and named Cheerio imports were adjusted without changing application dependency versions. skipLibCheck is temporary for invalid declarations in the legacy Cheerio release; revisit after step 4.

- Pin development to Node 24's latest patch; update engines and document the supported range. Remove misleading engineStrict metadata and enforce runtime versions through CI.
- Required package format: `type: "module"`, compiled ESM in dist, and an explicit root exports map with `types` and `import` entries. Include declaration files in the published package. Preserve intended named exports and `.js` relative import specifiers; provide no CommonJS output or require entry.
- Use `node:` built-in imports, explicit file extensions, and import.meta-based paths where module-relative paths are needed. Keep library imports free of compilation or process-exit side effects. Document intentional API changes for the subsequent companion updates.
- Replace generated index creation with a maintained explicit barrel so builds cannot silently change the public API.
- Introduce TypeScript 7's tsc build with NodeNext module/resolution settings, an explicit modern target, src rootDir, dist outDir, declarations, and source maps. Initially allow JS for incremental conversion if useful, then convert the small source tree to TypeScript and enable strict checking without broad `any` suppressions.
- Remove Babel configuration/dependencies and create-index once compiled-output and package-consumer checks pass.

### 4. Upgrade runtime dependencies and remove vulnerable wrappers

Status: implemented. Retained runtimes are Cheerio 1.2.0, klaw 4.1.0, Marked 18.1.1, Moment 2.31.0 and Sass 1.106.0; maintained replacements/extensions are yaml 2.9.1, mime-types 3.0.2, marked-smartypants 1.1.12 and marked-gfm-heading-id 4.1.4. Node file APIs, an awaited DOT serializer and direct Prince execFile calls replace the seven legacy wrappers. Modern Sass compilation, safe metadata/fragment handling, bounded YAML, contained embedded assets and explicit error propagation are covered by regression tests. The original HTML snapshot remains unchanged. Thirty-two routine tests and the real-Prince PDF check pass; the packed ESM consumer and NodeNext declarations pass. skipLibCheck has been removed. Production audit: zero findings. Full audit still reports 27 findings (18 high, 8 moderate, 1 low), all under ESLint and its import plugin; these remain for step 5. Trusted raw HTML/templates/SCSS are explicitly documented, not presented as sandboxed input.

- Make the removals/replacements in the table, refreshing the lockfile using the pinned Node/pnpm toolchain.
- Migrate Cheerio imports to `import { load } from 'cheerio'` and verify serialization/selector behavior. Its [1.0 migration notes](https://cheerio.js.org/blog/cheerio-1.0/) document the removed default instance.
- Upgrade Marked and remove obsolete options. Restore smart punctuation through a supported extension if fixture output needs it; check heading IDs and generated anchor references as well as list behavior. See [Marked's current and removed options](https://marked.js.org/using_advanced).
- Replace Sass renderSync with the modern compilation API; verify CSS imports, relative assets, and warning/error reporting. Review fixture and consumer stylesheets for deprecated Sass constructs. See [Sass migration guidance](https://sass-lang.com/documentation/breaking-changes/legacy-js-api/).
- Preserve read encodings and write directory creation; return rejected promises/errors instead of exiting the caller's process or silently succeeding.
- If replacing Graphviz's JS package, preserve exported generate_graph behavior and test quoted/escaped IDs and labels. Current code writes DOT and does not invoke a Graphviz executable.

### 5. Replace ESLint and add Oxfmt

Status: implemented with Oxlint 1.89.0 and Oxfmt 0.74.0. ESLint/import-plugin dependencies and .eslintrc.cjs are removed. Explicit correctness/import rules, Node globals, safe fix/format scripts and CI checks are in place. Native import export-validation was smoke-tested; import/no-unresolved is not natively available and its coverage difference is documented in docs/tooling.md alongside parser/style substitutions. Formatting preserves tabs, single quotes, semicolons and LF, while excluding fixtures, snapshots, generated output, lockfile and license text. Embedded formatting is disabled. All 32 routine tests, real-Prince output, packed ESM consumption, TypeScript declarations, lint and formatting checks pass; the original HTML baseline remains unchanged. Full and production pnpm audits both report zero findings.

- Add a checked-in .oxlintrc.json with Node globals, correctness rules, and the built-in import plugin. Explicitly map the existing eslint:recommended and import/errors coverage; verify resolution against source files and the package module format.
- The current config is legacy .eslintrc.cjs. For this small config, translate it directly; the automated migrator primarily targets flat configs. Check rule differences rather than assuming identical presets. See [Oxlint migration guidance](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint).
- Add .oxfmtrc.json preserving intended tabs, single quotes, semicolons, and LF endings. Ignore dist and backup artifacts; keep embedded HTML formatting conservative to avoid unexpected template changes. See [Oxfmt configuration](https://oxc.rs/docs/guide/usage/formatter/config).
- Add lint (`oxlint --deny-warnings`), lint:fix, format (`oxfmt --write .`), and format:check (`oxfmt --check .`) scripts. Remove .eslintrc.cjs, eslint, and eslint-plugin-import.
- Keep the initial formatting pass in a separate commit so dependency and behavior changes remain reviewable.

### 6. Finish TypeScript migration and enforce checks

Status: implemented. Every library module is .ts and TypeScript 7 checks the complete source with strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, unused-local/parameter checks and verbatimModuleSyntax. JavaScript input and skipLibCheck are disabled. All options, entry/front-matter, category, alias, figure, quality/power and character-sheet types are exported from the package root. Known fields are concrete types; metadata extensions remain unknown. klaw and mime-types use matching declaration packages; no broad any types or suppression directives were added. Shared runtime validators check YAML/JSON field shapes, dates, categories, enums and safe numeric values. The packed ESM consumer checks positive public type usage and expected invalid calls, including protection against accidental any returns. All 59 routine tests, real-Prince output, packed consumer/declaration checks, lint and formatting pass; the original HTML snapshot is unchanged. Full and production audits remain at zero findings.

- Define public Options, parsed entry/front-matter, category, alias, figure, and character-sheet types. Model optional fields explicitly and validate YAML/JSON at runtime: TypeScript alone cannot validate input files.
- Use Cheerio's bundled types and matching Node types; add narrow declarations/adapters only for retained untyped packages. Emit declarations for consumers and include them in package metadata.
- TypeScript 7 is released, installed through the normal typescript package, and provides the tsc command. It is suitable here because the project has no custom compiler-API integration. Its 7.0 release does not expose a compiler API; recheck this limitation only if adding tools that require one. See [Microsoft's release announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- Alternative if source conversion is deferred: native ESM JavaScript plus TypeScript checkJs/JSDoc can remove Babel without a full rewrite. SWC/esbuild/Oxc transforms are alternatives for special bundling or multiple-output needs, but add no necessary capability for the proposed single-library tsc build.

### 7. Validate distribution and automate maintenance

Status: implemented. Clean isolated Node 24.22.0 and 26.12.0 installs pass all quality/test/build/package checks. Electron 45.0.0 (Node 24.22.0) passes real main/utility-process compilation and error propagation in unpacked and ASAR layouts; real Prince output passes in each. Git SHA source installation exercises prepare with exact-commit build permission. All 59 routine tests pass, four PDF pages were rendered/visually reviewed, and full/production audits report zero findings. CI now covers Node 24/26, Linux/macOS Electron, weekly audits, Dependabot updates, and opt-in PDF validation/artifacts on a Prince-equipped self-hosted runner. Hosted CI execution awaits the first push; Windows is not in the current matrix. All intended library exports/types and trust/packaging requirements are documented. Companion-app migrations remain separate.

- Run a clean `pnpm install --frozen-lockfile`, lint, format:check, type checking, tests, and build on Node 24 and 26. Add actual latest-stable Electron import and compilation smoke tests as described above.
- Use `pnpm pack` to pack the library, install that tarball into a temporary consumer, and verify every intended named ESM export and public declaration from a consumer using NodeNext resolution. Check that dist is included, build artifacts are fresh, and backup files are excluded. Since installation is currently from GitHub, preserve that workflow with an appropriate prepare/build strategy or document a tested replacement.
- Run `pnpm audit` for the full tree and `pnpm audit --prod` for production dependencies; confirm all reported issues have been resolved and record the final results.
- Run the real PDF fixture with the supported Prince binary and inspect pagination and embedded assets. Confirm the standalone CLI-style and Electron consumer fixtures pass. Actual cross-doc-cli/cross-doc-gui migrations will follow separately.
- Add CI for these checks plus scheduled dependency/security updates. Document runtime requirements, build/install steps, trust assumptions, external PDF tooling, and the stable public API in README.

## Completion criteria

pnpm is pinned and used throughout, pnpm-lock.yaml is the sole dependency lockfile, and accidental npm development commands fail through the verified package-manager guard. All retained direct dependencies resolve to the latest stable versions checked at implementation time; removed packages have tested replacements. No unresolved audit findings remain. Babel and ESLint are removed; TypeScript 7, Oxlint, and Oxfmt checks pass. HTML, embedded assets, graph output, and PDF fixtures preserve intended behavior. Packed-package consumer fixtures work under Node and the latest stable Electron with the documented ESM-only API. All intended operations and types are available through public exports; the subsequent companion-application migrations are not a completion prerequisite.
