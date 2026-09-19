# Craft skills library: second opinion

Verified 2026-09-19 with read-only requests. No Craft content, credentials, configuration, or implementation changed.

## Original discussion

Cursor session `b5017f0d-7252-4319-ae3c-77e434ec1e9c`, September 18, 2026, 16:28–16:56 Europe/Berlin.

Transcript: `/Users/pavel/.cursor/projects/Users-pavel-Library-Application-Support-Cursor-glassMultiRootWorkspaces-1ar-lokki-plus-2-code-workspace/agent-transcripts/b5017f0d-7252-4319-ae3c-77e434ec1e9c/b5017f0d-7252-4319-ae3c-77e434ec1e9c.jsonl`.

User prompts are at lines 1, 17, 32, and 36. Main responses are at 15, 30, 34, and 43. The text transcript does not independently establish which model generated those responses; Grok attribution comes from Pavel.

## Verdict

Craft already supports the necessary discovery and retrieval primitives. A collection description field is the right design. A thin adapter can offer metadata-first discovery and on-demand instructions. Native skill installation, portable supporting files, and reliable versioning require additional work.

## Live evidence

Used the selected-document Connect supplied in the original session, without authorization headers. Its URL is deliberately omitted here.

| Probe | Result |
| --- | --- |
| GET /documents | One document, SKILLS |
| GET /collections | SKILLS db, 112 items |
| GET collection schema | description is a string; tags is multi-select |
| GET items?maxDepth=0 | 77,161 bytes; 112 rows; zero content fields; 110 nonempty contentPreviewMd fields |
| Filter tags containing skill | 11 rows; all 11 have no populated description |
| GET items?maxDepth=1 | 612,703 bytes; content present on all 112 rows |
| GET /blocks for Agent: Learn | Individual collection item and instruction body retrievable |
| Project 11 rows to id, title, description | 1,117 UTF-8 bytes using compact JSON, descriptions currently empty |

The API supports shallow retrieval, but it does not return strictly metadata-only data: body previews remain. An adapter must explicitly project allowed catalog fields before passing output to the model. This reduces model context, not bytes downloaded from Craft.

The current collection handler calls getItems before filterCollectionItems. Property filters and limits are client-side. They are not authorization boundaries. The working tree also contains concurrent changes that strip previews from normal CLI output; this does not alter the raw API response.

The original statement that the response has only id, title, and properties is therefore inaccurate for today's raw API. Historical byte sizes and row counts are snapshots, not contracts.

## Corrections and qualifications

- Selected-document access is sufficient for this library. Listing one document and reading its descendants was verified. Folder 404s do not prove access enforcement; a negative test against a known unrelated document was not performed.
- All rows inside the selected document are accessible, including prompts without the skill tag. A publication flag can control adapter output but cannot hide drafts from someone who has the raw Connect URL/key.
- The supplied Connect still responds without authentication. The previous claim that embedded credentials exist was not independently audited; no credential values were reproduced.
- Notion currently documents three relevant endpoints: list plugins, get plugin, and get individual skill. Its API returns downloadable skill/plugin archives, not merely page Markdown.
- Craft lastModifiedAt is useful metadata, not a proven equivalent of Notion's content-version contract. The live root timestamp was older than a child's timestamp. Do not assume a root timestamp covers all descendant changes. Hash normalized exported metadata, instructions, and supporting files for a reliable artifact identity.
- Agent: Learn is readable, but its body contains Craft callout markup and instructions explicitly written for Claude web. Retrieval does not prove portability or current semantic suitability across agents.
- Native discovery requires an integration: a locally installed loader skill, startup catalog injection, or synchronization into each agent's supported skill location. Text above the Craft collection is helpful documentation but cannot make an unconfigured agent discover the library automatically.

## Recommended first implementation

1. Keep the selected document and collection. Add stable name/slug, kind (skill/prompt/instructions), and status (draft/published/archived). Keep description and topic tags. Defer a separate packs field until actual distribution groups are needed.
2. Build list and get in craft-cli first. List explicitly requests depth zero, filters published skills, validates nonempty descriptions, and returns only id/name/description/tags. Get resolves a stable ID or slug and retrieves one instruction body.
3. Provide one small local loader skill describing when and how to query the catalog. This enables API-based use without syncing every body locally. Discovery still depends on the agent invoking the loader; test this with a fresh session.
4. Add export when native installation is needed: valid SKILL.md frontmatter, normalized Markdown, stable filenames, explicit supporting-file mapping, rewritten links, and content hashes. Preserve code and literal content; avoid blanket removal of XML-like text.
5. Keep exported files in a distinct generated location with one-way ownership. Never blindly overwrite the existing canonical engineering skills repository. Add archive/plugin packaging only for an actual consumer.

Use the configured remote connection for library discovery. A space-wide local cache must not become the source for a document-scoped access claim. Cache entries should be isolated by connection and library identity.

Suggested command names such as craft lib list/get/export remain proposals, not implemented commands. Existing craft skills is a local executable-skill runner and should retain its meaning.

## Sources checked

- [Notion announcement](https://www.notion.com/blog/a-skills-library-for-every-agent)
- [Notion Agent Skills API](https://developers.notion.com/guides/agent-skills/overview)
- [Notion list plugins and version contract](https://developers.notion.com/reference/agent-skills/list-skills-plugins)
- [Notion individual skill download](https://developers.notion.com/reference/agent-skills/get-skill-directory)
- [Craft collection API and maxDepth](https://connect.craft.do/api-docs/space)
- [Agent Skills specification](https://agentskills.io/specification)
- [Vercel skills CLI direct downloads](https://github.com/vercel-labs/skills/blob/main/README.md)

Local source inspected: src/cli/commands/collections.ts, src/lib/collections.ts, src/lib/collection-items.ts, src/cli/commands/skills.ts, and the canonical skills repository layout. Existing unrelated dirty changes were preserved.
