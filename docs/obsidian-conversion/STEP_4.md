# Step 4 review: inline figures and source-relative assets

Implemented without moving or rewriting legends-walk.

## Behavior to review

- Standalone Markdown images with nonempty titles render as figures where they occur.
  Image titles supply literal captions; alternative text stays independent. Inline and
  reference-style Markdown use the same path. Untitled/prose images, raw HTML image titles
  and code examples do not become figures.
- Inline figures precede appended metadata figures in each note's ordinal sequence.
  Header references, numbered captions, figure TOC links and selected-output numbering
  share the existing pipeline. Reused files are not deduplicated, and each declared
  figure renders once. Migration must remove replaced metadata explicitly.
- Compatibility mappings now validate against both formats. Canonical figure fragments
  resolve through the shared resolver, including encoded note paths; selected output
  unlinks excluded owners. Figure references expose numbered caption titles.
- Configured note/layout images and navigational assets resolve from their source files.
  Sass source maps identify imported partials for CSS URLs. Local CSS imports, fonts,
  additional stylesheets and inline styles embed their local dependencies. Referenced
  SVG images/symbols and CSS URLs, including presentation attributes, also validate
  recursively. Resource fragments remain intact. Sources are not copied or rewritten.
- Missing files, bad encodings and escaping paths/symlinks fail with source context
  before Prince. Sass imports are checked for containment, and CSS/SVG cycles fail.
  Configured `srcset` is explicitly unsupported. Legacy themes and fragment-only
  rendering retain their historical behavior.

See [the public API contract](../public-api.md#inline-figures-and-source-relative-assets-step-4)
for syntax, composition and resource boundaries.

## Validation evidence

- Library: 215 tests pass; four optional native tests are skipped by default. The new
  24-test suite covers placement, mixed formats, reference images, captions/escaping,
  independent alt text, IDs, mapped/canonical references, selected output, encoded
  filenames, nested note paths, layout/partial/CSS assets, SVG dependencies, containment,
  symlinks, missing resources and dependency cycles.
- CLI: 108 tests pass; two optional checks skipped. The executable publishes mixed
  inline/metadata figures and embeds both without duplication. GUI: 95 tests pass;
  one optional check skipped. Configured publication verifies nested inline figure
  IDs, captions, normalized image URLs and embedded resources.
- Strict TypeScript checks, builds, lint and formatting pass for library/CLI/GUI.
  The GUI retains its existing large-bundle advisory.
- A separate real Prince test passes for mixed inline/metadata figures: header links,
  the mapped legacy reference and figure TOC links reach the appropriate caption pages.
  Both SVG images render; all three fixture pages were inspected after Poppler rendering.
  Temporary PDF artifacts remain outside the source tree.
- The complete 464-entry campaign still reports 35 diagnostics. Generated A5 HTML is
  byte-identical to the frozen baseline, all 552 input hashes match, and legends-walk
  Git status remains clean. The comparison caught and prevented a regression in
  historical multi-H1 header rendering.

No dependencies or lockfiles changed. As in steps 2–3, adapter validation refreshes the
built library in existing local package snapshots because offline Sass 1.106.1 metadata
prevents a fresh install. Clean-install/package/Electron validation is not claimed.

## Subsequent work

Step 5 extends output formats/artifact reporting and portable companion packaging.
Linked HTML still refers to source attachments; complete HTML embeds supported local
assets. This is not a general browser dependency crawler: remote dependencies, scripts,
arbitrary compound documents and Obsidian embeds are outside the supported asset subset.
The migration tool and real collection conversion remain later steps. No plugin or
vault installation was performed here.
