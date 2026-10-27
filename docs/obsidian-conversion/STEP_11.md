# Step 11 — real vault conversion and development installation

The real `legends-walk/` directory is now the vault and compiler project root.
It contains 464 notes in `notes/`, attachments, publishing configuration and all
five themes, editable artwork/covers, and the excluded `drafts/report.md`.
Basenames and frontmatter category IDs were preserved. No nested vault was made.

The user accepted step 10 and authorized the next stage. A fresh dry run and full
disposable rehearsal preceded application. Live input hashes were checked by the
migrator before its 539 operations (537 source moves plus two new configurations).
No blocking issues occurred. The migration made 2,298 reviewed source edits and
appended 27 inline figures with their original attachment bytes and captions.

## Preservation and verification

- All 539 resulting files match the fresh rehearsal byte for byte.
- 405 note headers are byte-identical. Another 59 remove only the `figures` key;
  other YAML source is unchanged, including comments, relationships and nested data.
- Full compilation discovers 464 entries and 27 figures. All five themes render.
  The rehearsal compares links, content, selection, categories, aliases, figures,
  character sheets and timeline against the legacy output.
- Diagnostics remain exactly 35 reciprocal-link warnings and 909 expected legacy
  relationship notices; no missing or ambiguous targets were introduced.
- Repeat migration planning reports already migrated with zero operations.
- Fresh live A5/reduced exports have 21/17 pages and extracted text of
  28,694/25,606 bytes. Every rendered page is pixel-identical to the fresh rehearsal;
  all 38 rehearsal pages were visually inspected for text, figures and pagination.
- The rehearsal rollback restored all 552 inventoried hashes and modes before
  reapplication. The live external rollback journal remains intact.

See [the verification summary](step-11-verification.json). The original move map
remains frozen under `baseline/`; no unrelated theme or confidentiality fixes were
included. Fifteen unreferenced/generated/metadata files remain at their original
legacy paths pending review, listed individually in the verification JSON. Old
legacy folders therefore remain visible but are not configured compiler inputs.

The ignored `out/`, `TEST.pdf` and `test.dot` outputs (82 files) were moved into an
external archive, with before/after hashes checked. Nothing was deleted.
`.gitignore` now excludes local `.obsidian/` state and optional `/exports/`.
The new vault README explains editing, configuration and development installation.
Final font policy, confidentiality decisions and cross-platform rollout remain
stage 12 or the existing workspace TODOs.

## Plugin installation and checks

`cross-doc-obsidian/install-dev.mjs` validates the project, entry directory,
manifest and all five built files. It creates a relative link to the distribution:

```text
legends-walk/.obsidian/plugins/cross-doc-obsidian
  -> ../../../cross-doc-obsidian/dist
```

Repeat installation returns `unchanged`. Real directories, wrong/broken links and
symlinked preference parents are rejected without replacing them. Preferences are
preserved; enabling the plugin is a manual Obsidian action. Build output retains
its directory so rebuilds preserve the installation. Fully restart Obsidian after
rebuilding to reload cached desktop modules.

Strict format, lint, all three TypeScript graphs, 342 tests and 100% coverage in
59 runtime files pass. The five-file bundle builds successfully. The installed
symlink's desktop adapter and standalone child process discover 464 notes, all
five themes and zero catalog errors, without starting Obsidian. Installation is
tested from another working directory and after a rebuild. Project-owned type
definitions remain centralized in `src/types.ts`.

Obsidian itself was not opened or controlled. Follow
[the step 11 manual review](../../../cross-doc-obsidian/MANUAL_TESTING_STEP_11.md)
to load the real vault, review editing/links/figures, publish and verify a rebuild.
Stage 11's native review remains pending; stage 12 covers broader acceptance.

## Recovery records

Keep this external directory until the converted vault is accepted:

```text
/Users/david/prog/cross-doc/.migration-backups/legends-walk-20261027T195002Z/
  preflight.json                 original Git HEAD, status and move-map hash
  live-plan/                     applied plan and full source-edit report
  live-journal/                  checked originals and operation journal
  rehearsal/                     before/after, rollback and PDF evidence
  published/                     live HTML/CSS, PDFs and rendered pages
  live-verification.json         live preservation assertions
  verify-live.mjs                 one-time verification script
  setup-originals/gitignore      exact original root ignore file
  setup-manifest.json            installation/artifact fingerprints
  generated-before-migration/    previous generated outputs
  generated-archive.json         archived file hashes and modes
```

The source Git HEAD before conversion was
`6f23f79eca120623eca925f847cc74f62fbc0397`; the collection was clean. No changes
were committed or staged. The journal covers migration inputs; root README,
ignore-file changes, plugin link and generated-output archival are separate setup
actions, recorded above.

For a deliberate rollback, first quit Obsidian and save/copy any edits made since
conversion. From the library directory, run:

```sh
node scripts/migrate-obsidian.mjs rollback --journal \
  ../.migration-backups/legends-walk-20261027T195002Z/live-journal
```

Rollback rejects changed targets or conflicting original paths rather than
overwriting new edits. If rejected, retain the journal and reconcile those files;
do not force-reset the repository. After a successful rollback, separately undo
setup only after checking for subsequent edits: remove only the recorded plugin
symlink (never its target), retain any newly created vault preferences, restore
the saved `.gitignore` if still unchanged since setup, and remove the generated
README only if it has no new edits. Move each archived output back only when its
original destination is absent, checking `generated-archive.json`. Do not remove
the backup directory until recovery is verified.

## Reference-link remigration

On 27 October 2026, the updated migration code expanded the live vault's 161
reference-style links/images across 59 notes and removed 159 consumed definitions.
All 464 headers remain byte-identical; compiled entry markup, diagnostics and
available themes are unchanged. A repeat pass produces zero edits. Existing file
links, attachments, figures and post-conversion edits were preserved in place.

This follow-up has its own external journal:
`/Users/david/prog/cross-doc/.migration-backups/legends-walk-reference-links-20261027/`.
It includes `manifest.json` with source/result hashes and patches, `originals/`,
the applied `remigrate.mjs`, and a checked `rollback.mjs`.

If reverting the original layout conversion, **undo this follow-up first**, after
quitting Obsidian and preserving subsequent edits:

```sh
node .migration-backups/legends-walk-reference-links-20261027/rollback.mjs
```

Run that command from the workspace root. It checks every current note and backup
hash before writing, rejects new edits, restores the 59 previous files and retains
the originals. Then follow the original migration recovery instructions above.
The original stage 11 journal has not been modified. Native Obsidian review of
these new inline links remains a manual check; no app interaction was performed.

## Wrapped-label remigration from the original revision

The migration was rerun from original repository revision
`6f23f79eca120623eca925f847cc74f62fbc0397`, restored separately using `git archive`.
Ignored original inputs were restored from the preserved inventory; all 552 source
hashes matched the original preflight. No post-conversion edits were present in
any target before replacement. Git history, vault preferences, the plugin symlink,
README, retained resources and archived exports were preserved.

The complete rehearsal passed again: 539 operations, 2,608 source edits, 464 notes,
27 figures, all five themes, semantic full/selected output checks, zero repeated
migration operations, and rollback restoring all 552 original hashes/modes. It
includes reference expansion and 154 line-break joins inside link/image labels.
All 539 live targets now match this regenerated result. Relative to the previous
live state, 110 notes changed; all frontmatter remains unchanged and compiled entry
markup is equivalent after whitespace normalization. Diagnostics are unchanged.
The three reported links in `mordredii.md` now each occupy one source line.

Strict lint, formatting, TypeScript and build pass; 321 library tests pass, with
five optional native tests skipped. No PDF regeneration or direct Obsidian test
was needed for this source-format correction. Reopen the notes in Obsidian to
check their Live Preview links.

The latest external journal is
`/Users/david/prog/cross-doc/.migration-backups/legends-walk-wrapped-links-20261027/`.
It contains original-source provenance, the complete fresh rehearsal/journals,
`live-manifest.json`, `live-originals/`, the guarded installation script and
`rollback.mjs`. Preserve all earlier journals too.

For recovery, quit Obsidian and preserve any subsequent edits. From the workspace
root, first run:

```sh
node .migration-backups/legends-walk-wrapped-links-20261027/rollback.mjs
```

It refuses current-file or backup hash conflicts and restores the prior 110 notes.
To revert further, then undo the reference-link follow-up, then the original layout
conversion, in that order using the instructions above. Do not run an older
rollback directly against the newest files.

## Empty legacy-directory cleanup

The migration now prunes empty ancestors of moved sources after validating output.
It uses bottom-up `rmdir`, retains nonempty directories and refuses symlinked
paths. Rollback recreates source directories as it restores original files.
Tests cover nested folders, retained resources, repeated cleanup and rollback.
The library has 323 passing tests (five optional native tests skipped); strict
lint, TypeScript, build and formatting checks pass.

The live cleanup removed 16 empty legacy directories, including `data/` and its
seven category folders. The only remaining file in `data/` was Finder metadata;
`data/.DS_Store` was archived with its hash and mode, not deleted. Other retained
resources and nonempty legacy directories remain untouched.

Records and the archived metadata are at
`/Users/david/prog/cross-doc/.migration-backups/legends-walk-empty-directories-20261027/`.
**Before any older rollback**, quit Obsidian and run from the workspace root:

```sh
node .migration-backups/legends-walk-empty-directories-20261027/rollback.mjs
```

That restores removed directories and the archived Finder file, rejecting unsafe
paths or an existing destination. Then undo wrapped-label conversion, reference
conversion and the initial migration in reverse chronological order as above.
