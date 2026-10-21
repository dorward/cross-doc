# Linting and formatting

Use the pinned Oxlint 1.89.0 and Oxfmt 0.74.0 through pnpm:

```sh
pnpm run lint
pnpm run lint:fix
pnpm run format
pnpm run format:check
```

CI runs lint and format checks before type checking, tests and the packed-package
consumer check. Warnings fail lint. `lint:fix` applies safe fixes only; it does not
enable dangerous fixes or suggestions. ESLint, eslint-plugin-import and the old
.eslintrc.cjs have been removed.

## Rule migration

Explicit any types are rejected by the TypeScript lint plugin. The compiler also
enforces strict checks, indexed-access/optional-property checks, unused locals
and parameters, and type-only imports. The former ESLint 8 recommended rules are explicitly enabled in .oxlintrc.json
where supported, alongside Oxlint's correctness category and Node/modern ES
globals. Unused arguments/variables intentionally prefixed with `_` are allowed.
The following rule differences are deliberate:

| Previous coverage                                             | Replacement                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| import/named, import/default, import/namespace, import/export | Oxlint's native import plugin, explicitly enabled                                                                                                                                                                                                                                                                                                                                        |
| import/no-unresolved                                          | Not available as a native Oxlint rule in this version. Vitest and the native packed-package consumer exercise actual resolution; the latter eagerly loads all 14 public operations and their internal modules. This is runtime/build coverage, not an equivalent per-file lint rule. Strict TypeScript NodeNext checking now validates source-module resolution at compile time as well. |
| no-new-symbol                                                 | no-new-native-nonconstructor, which also covers other nonconstructible built-ins                                                                                                                                                                                                                                                                                                         |
| no-dupe-args, no-octal                                        | Strict-mode parsing rejects these constructs. Project modules are ESM; the CommonJS package-manager guard explicitly uses strict mode.                                                                                                                                                                                                                                                   |
| no-extra-semi, indent, quotes, semi, linebreak-style          | Oxfmt removes extra semicolons and enforces tabs, single quotes, semicolons and LF endings                                                                                                                                                                                                                                                                                               |

Migration verification used temporary valid/invalid files to confirm Node globals,
relative module resolution, missing named/default/namespace exports, and undefined
variables. The probes are removed afterward. Do not claim identical ESLint preset
behavior; the checked-in explicit configuration records the intended rules.

## Formatting boundaries

Oxfmt formats code, configuration and documentation. Embedded-language formatting
is disabled to preserve HTML and executable template literal contents. Fixtures,
expected HTML, generated dist/coverage, the pnpm-managed lockfile, backup files,
and literal license text are excluded. In particular, formatting must not rewrite
the test input project or regenerate the expected HTML snapshot. Existing document
output is verified by the regression and real-Prince checks after formatting.
