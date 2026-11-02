# Step 3 review: shared links and heading destinations

Implemented without moving or rewriting the live legends-walk collection.

## Behavior to review

- Public `resolveLinks` resolves Markdown inline/reference links and Wikilinks through the same project index. Labels are preserved. Markdown paths use source-relative lookup; Wikilinks support vault paths and unique suffix lookup. Exact spelling precedes portable case/Unicode matching. Ambiguous names report candidates rather than choosing a file. Metadata aliases remain separate from file lookup.
- Heading targets use source text before typography, support local and hierarchical references, and receive namespaced IDs. Repeated headings, Unicode, spaces, percent signs and manual HTML anchors have explicit coverage. Only the first H1 becomes the entry header in resolved documents; subsequent H1s remain section headings.
- Reciprocal checks, one-way declarations, excluded-output unlinking, title attributes and graphs resolve heading links to their owning entry. CLI inspection and GUI publishing use the shared library behavior and expose bounded candidate diagnostics.
- Full indexes distinguish missing targets from excluded entries and nonpublished files. Containment checks reject unsafe destinations. External URLs, code examples and SVG/Math internals remain untouched. Attachment navigation preserves viewer fragments, including embedded data URLs.
- Configured projects always resolve links. Legacy projects activate resolution for new syntax/local anchors while retaining existing fragment-only output and progress behavior.

See [public API documentation](../public-api.md#project-aware-links-and-heading-targets-step-3) for lookup rules, diagnostics and standalone composition.

## Validation evidence

- Library: 191 tests pass; three optional native checks are skipped in the default suite. The resolver suite includes 39 tests covering both formats, heading identity, ambiguity, encoding, selection, containment, code preservation and compatibility.
- CLI: 107 tests pass; two optional checks skipped. GUI: 95 tests pass; one optional check skipped. Adapter tests cover inspection, candidate transport, progress and publication.
- Library, CLI and GUI builds, strict TypeScript checks, lint and formatting checks pass. The GUI retains its existing large-bundle advisory.
- A separate real Prince test passes: Markdown, Wikilink, manual-anchor and Unicode references navigate to their intended PDF pages. All five rendered fixture pages were visually inspected. Temporary PDF artifacts are outside the source tree.
- Real campaign compilation retains 464 entries and 35 diagnostics. Full A5 HTML was compared byte-for-byte with the frozen baseline. All 552 source hashes remain unchanged and legends-walk Git status is clean.

No dependencies or lockfiles changed. As in step 2, offline Sass 1.106.1 metadata prevents a fresh dependency installation; adapter checks use refreshed built library snapshots in their existing local packages. Clean-install/package/Electron validation is not claimed.

## Boundaries

Inline image figures and migration remain step 4 and later. Note/attachment transclusion, block references, heading searches and local query strings are diagnosed as unsupported. Ambiguous lookup deliberately requires an explicit path. Actual Obsidian runtime and plugin acceptance remain future steps; this implementation does not claim to reproduce every Obsidian lookup heuristic.

Legacy fragment-only rendering is preserved, including historical heading behavior. The migration will opt into the improved first-H1 handling and must review resulting section headings against the baseline. No campaign templates or sources were migrated here.
