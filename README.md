# Cross-Doc

Cross-Doc is a JavaScript library designed to run under Node.js which helps
compile a collection of markdown files into HTML and PDF documents while
adding indexes and doing some management of cross-references.

## Installation

Use pnpm to install cross-doc. If you are an end user you will probably want to
install cross-doc-cli instead.

Until a registry release is published, install a reviewed Git commit, or build
and pack a checkout (replace COMMIT_SHA with the reviewed commit):

```sh
pnpm add 'github:dorward/cross-doc#COMMIT_SHA'
# In a source checkout:
pnpm install --frozen-lockfile
pnpm pack
# In a consuming project:
pnpm add /path/to/cross-doc-0.0.1.tgz
```

Git dependencies must run the prepare build. pnpm 12 requires an explicit
allowBuilds entry in the consuming project's pnpm-workspace.yaml for cross-doc;
prefer an entry restricted to the reviewed Git URL and commit shown in pnpm's
diagnostic. The tested tarball installation needs no source build permission.

## Usage

The package is ESM only. Import operations from the package root:

```js
import { get_files, read_files, parse_data } from 'cross-doc';

const files = await get_files({ project: '/path/to/project' });
const entries = parse_data(await read_files(files));
```

The original operations remain available alongside `select_files`, `loadProject`,
`compileProject` and `CompilationError`; private deep imports and CommonJS
`require('cross-doc')` are unsupported. Run compilation in a Node-capable
Electron main or utility process and expose narrow IPC operations to the GUI.
The CLI and GUI delegate to the shared pipeline through their own adapters.

`pnpm run build` uses TypeScript 7 to emit native ESM, declarations, and source
maps into a freshly cleaned `dist`. `pnpm pack` and Git dependency installation
run the prepare build automatically; published tarballs contain compiled output
and do not require consumers to compile TypeScript. All library source is strict
TypeScript, with checked optional fields/index access and no implicit or explicit
`any` types. Public options, entries, aliases, figures, sheets and categories are
exported as types from the same package root. Dependency declarations are checked.

```ts
import { parse_data, type RawDocument, type ParsedEntry } from 'cross-doc';

const documents: RawDocument[] = [{ path: 'alice.md', contents: '---\ntype: person\ntitle: Alice\n---\n# Alice' }];
const entries: ParsedEntry[] = parse_data(documents);
```

YAML metadata and category JSON are validated at runtime, including optional
arrays, aliases, figures, character-sheet values and category sort modes. Dates
must be valid Date values or ISO date strings; chronological categories require
entry dates. Unknown top-level metadata is preserved as `unknown` and must be
narrowed before use. See [the API contract](docs/public-api.md) for field rules.

See [the fixture project](tests/fixtures/project) and
[the API baseline](docs/public-api.md) for the current document pipeline.

## Contributing

Use Node.js 24.22.0 or newer and pnpm 12.14.0 for development.
`.node-version` pins the development/CI runtime to Node 24.22.0. Install that pnpm
version using the [pnpm installation instructions](https://pnpm.io/installation).
The exact version is pinned in `package.json` and used by CI. With an existing
pnpm 11.10+ installation, `pnpm with 12.14.0 install --frozen-lockfile` can run
the pinned version without replacing your global installation.

```sh
pnpm install --frozen-lockfile
pnpm run check:package-manager
pnpm run build
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test:package
pnpm run test:git
pnpm run test:electron
pnpm test
pnpm run test:coverage
pnpm audit
pnpm audit --prod
pnpm pack
```

Commit dependency changes with `pnpm-lock.yaml`; do not create npm or Yarn
lockfiles. CI checks the package manager, installs with a frozen lockfile, and
checks Oxlint/Oxfmt, runs the Vitest regression suite and builds the library.
Use `pnpm run lint:fix` for safe lint fixes and `pnpm run format` to format code.
[Tooling notes](docs/tooling.md) record migrated rules and formatting exclusions. See
[the test guide](tests/README.md) for watch mode, snapshot review, known legacy
behaviors, and optional real-Prince PDF checks. The public operation inventory
and public TypeScript types are recorded in [the API baseline](docs/public-api.md).

Modern npm rejects `npm install`, `npm ci`, and `npm run` in this checkout via
`devEngines.packageManager`. This prevents accidental use, but older npm
versions and deliberate overrides such as `--force` can bypass it. Consumers
installing the packaged library are free to use their own package manager.

Dependency installation scripts require explicit review in
`pnpm-workspace.yaml`. Sass's optional watcher build is disabled; compilation
uses the packaged binaries without that installation script. The latest Sass
release has an explicit release-age exception; other packages retain the age
gate. Electron 45.0.0 is a development-only test runtime; its official binary
is downloaded on first launch. ASAR tooling is also development-only.

The CI matrix covers Node 24/26 and Electron on Linux/macOS, with weekly audit
runs and Dependabot updates. Real-PDF CI can be dispatched on a self-hosted runner
with Prince/Poppler. [Validation notes](docs/validation.md) record local results,
the tested ASAR layout, Git install requirements and integration commands.

## PDF output and input trust

Install the [Prince executable](https://www.princexml.com/download/) separately
and meet its licensing requirements. PDF output uses `prince` on PATH, or an
explicit `prince_binary` path in output options, with a 30-second timeout and
30 MiB output limit. The npm Prince wrapper and automatic binary downloader
have been removed. Failed rendering rejects the promise. Prince runs with
network access disabled and JavaScript remains disabled by default.

Projects, Markdown/raw HTML, templates, SCSS, and caller-supplied options must
be trusted. This library does not sanitize arbitrary HTML or sandbox Sass or
Prince's local file access. Use process isolation and an HTML sanitization
policy before adding support for untrusted projects. Metadata rendered by the
library is escaped; YAML has header-size, nesting and alias-expansion limits.
Unsafe keys, malformed YAML, invalid required metadata, missing files and
invalid includes now throw/reject instead of exiting or silently succeeding.

Embedded assets must stay inside the project directory, including after
symlink resolution. The legacy `../resources/...` and `../templates/...`
references remain supported. External, fragment and data links remain unchanged;
remote assets are not downloaded. Embed CSS resources in the project yourself;
nested CSS url()/@import resources are not recursively bundled. Graph output
can be directed with `graph_file_name`; the default remains `test.dot`.

Pull requests are welcome. For major changes, you may wish to open an issue
first to discuss what you would like to change as rejection after doing the
work may hurt.

## Contributors

- [David Dorward](https://github.com/dorward/)

## License

[ISC](LICENSE.md)

For complete compilation, use `compileProject` with explicit theme and output
paths. `loadProject` provides the same validated preparation without writing
output or invoking Prince. Both offer structured progress; compilation returns
artifact facts and errors preserve their cause/stage. See the
[shared pipeline contract](docs/public-api.md#shared-project-pipeline).

Project inspection is available through `inspectProject`, `readCategories` and
`listThemes`; `validateTheme` checks a selected name against discovered themes.
`loadProject` includes the validated categories and theme names in its result.

Shared pipelines return structured link diagnostics and accept an onDiagnostics
callback without printing them. Use analyzeLinks for standalone analysis; the
legacy warn_missing_reciprocal_links stderr wrapper is deprecated but preserved.

Use writeGraph(document, { graph_file_name }) for opt-in DOT output with an
explicit path. The deprecated generate_graph wrapper retains its test.dot
fallback for 2.x; shared compilation does not generate graphs.
