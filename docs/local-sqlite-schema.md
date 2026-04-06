# Craft Docs local data stores - schema and analysis

investigated: 2026-04-06

## file inventory

### Search/ directory (SQLite - FTS5 search indices)

| file | size | modified | description |
|------|------|----------|-------------|
| `SearchIndex_{spaceId}.sqlite` | 23.7 MB | 2026-04-06 12:59 | main space ("1ar main"), 46110 rows |
| `SearchIndex_{secondarySpaceId}.sqlite` | 7.3 MB | 2026-04-06 12:28 | secondary space ("1ar"), 126 rows |
| `SearchIndex_8ac88104...||0a7745af...sqlite` | 1.3 MB | 2026-03-14 22:14 | shared docs (Birkenfactory), 1225 rows |
| `SearchIndex_53b22155...||0a7745af...sqlite` | 1.3 MB | 2026-03-10 00:27 | shared docs (Birkenfactory via 1ar space), 1172 rows |
| `SearchIndex_53b22155...||116da254...sqlite` | 438 KB | 2026-02-23 21:55 | shared docs (unknown team), 702 rows |

each .sqlite has a companion `.version` file containing `14` (version number).

naming convention: `SearchIndex_{spaceId}.sqlite` for own space, `SearchIndex_{spaceId}||{teamId}.sqlite` for shared/team spaces.

### Realm files (binary - primary data store)

| file | size | modified |
|------|------|----------|
| `LukiMain_8ac88104..._E4C000C5...realm` | 52 MB | 2026-04-06 18:32 |
| `LukiMain_53b22155..._2C6918A5...realm` | 32 MB | 2026-04-06 18:32 |
| `LukiMain_8ac88104...||0a7745af...realm` | 18 MB | 2026-04-06 15:42 |
| `LukiMain_53b22155...||0a7745af...realm` | 18 MB | 2026-04-06 15:42 |
| (plus 8 more smaller Realm files for various team combos) | | |

naming: `LukiMain_{spaceId}_{deviceId}.realm` or `LukiMain_{spaceId}||{teamId}_{deviceId}.realm`

Realm model classes found via binary strings:
- `BlockDataModel`
- `DocumentDataModel`
- `FolderDataModel`
- `ObjectLinkDataModel`
- `CommentDataModel`
- `ContributorDataModel`
- `DocumentShareDataModel`
- `DocumentUserAttributesModel`
- `MetaObjectDataModel`
- `SpaceConfigDataModel`
- `UserConfigDataModel`
- `UserMetaObjectDataModel`
- `UserObjectLinkDataModel`

Realm files are binary and cannot be queried with sqlite3. they contain the full document tree, block hierarchy, folder structure, and metadata. the SQLite files are derived search indices.

### PlainTextSearch/ directory (JSON - per-document full text)

1218 JSON files for "1ar main" space, 18 for shared docs. one file per document.

### Other directories

| directory | contents |
|-----------|----------|
| `Tags/` | JSON stats per space - recently used tags with timestamps |
| `TagRules/` | regex-based tag rules (hexcolor-v1, number-v1) |
| `CollaboratorsCache/` | JSON files with collaborator info per team space |
| `CraftAgentThreads/` | directories for AI assistant thread data |
| `DocumentTemplates/` | template categories (Meetings, Personal, etc.) |
| `Localization/` | translation JSON files (14 languages) |
| `NotificationInbox/` | task deadline notifications with deeplinks |
| `Reminders/` | block-level reminders with due dates, deeplinks |
| `QuickSearch/` | icon usage statistics |
| `ThemePresets/` | 174 KB of theme presets |
| `UserKeyValueStore/` | per-space settings (tag config, AI assistant config, saved styles) |
| `Logs/` | app logs (54 KB JSON) |
| `raycast-spaces-config.json` | maps space IDs to display names and enabled state |

---

## SQLite schema (Search/ databases)

all search databases share identical schema.

### table: BlockSearch (FTS5 virtual table)

```sql
CREATE VIRTUAL TABLE "BlockSearch" USING fts5(
    id,
    content,
    type,
    entityType,
    customRank,
    isTodo,
    isTodoChecked,
    documentId,
    stamp UNINDEXED,
    exactMatchContent,
    tokenize='unicode61'
);
```

FTS5 internal tables (auto-generated):
- `BlockSearch_data` - FTS data blobs
- `BlockSearch_idx` - segment index
- `BlockSearch_content` - content store (c0..c9 map to the 10 columns)
- `BlockSearch_docsize` - document size info
- `BlockSearch_config` - FTS config (`version` = 4)

### table: SearchConfig

```sql
CREATE TABLE IF NOT EXISTS "SearchConfig" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
);
```

contains: `lastStampCheckDate` = Unix timestamp of last index sync check.

---

## column analysis

### id
UUID of the block/document/page. for documents, this is the **title block ID** (different from documentId). for blocks, this is the block UUID.

### content
**plain text only** - no markdown formatting preserved. bold markers (`**`), links (`[text](url)`), etc. are stripped. hashtags from URL metadata bleed through (e.g. `#barber` from YouTube descriptions) but Craft's own `#tag` syntax is not stored in block-level content.

for document entities, content = the document title text.
for url blocks, content = URL + page title + meta description concatenated with spaces (URLs have punctuation stripped: `https x com user status 123...`).
for code blocks, content = the code text as-is (but no language annotation).

### type

| value | count (main space) | description |
|-------|-----|-------------|
| `text` | 41922 | regular text blocks + document titles |
| `image` | 1413 | image blocks |
| `url` | 731 | web link / bookmark blocks |
| `object` | 695+611 | database row blocks (block) / database page views (page) |
| `code` | 560 | code blocks |
| `video` | 99 | video embeds |
| `file` | 45 | file attachments |
| `objectList` | 22 | database/collection list views |
| `whiteboard` | 12 | whiteboard blocks |

### entityType

| value | count | description |
|-------|-------|-------------|
| `block` | 43662 | content blocks within documents |
| `document` | 1245 | top-level documents (title entries) |
| `page` | 1203 | subpages (nested page blocks inside documents) |

### customRank

7-digit integer encoding entity type priority and some ordering signal.

**first digit** = entity type tier:
- `1` = document (highest priority in search results)
- `2` = page
- `3` = block (lowest priority)

the remaining 6 digits encode a secondary ranking. commonly seen patterns:
- `968` in positions 2-4 is extremely common (e.g. `1968301`, `3968201`)
- the last 3 digits vary and likely encode block type or style

top customRank values by frequency:
- `3968201` (8846 blocks) - most common block rank
- `3968102` (4280)
- `3968101` (3701)
- `1968301` (347 documents)
- `1968101` (320 documents)
- `2968101` (346 pages)

### isTodo / isTodoChecked

| isTodo | isTodoChecked | meaning |
|--------|---------------|---------|
| `0` | (empty) | not a todo |
| `1` | `0` | unchecked todo |
| `1` | `1` | checked/completed todo |
| `1` | `2` | cancelled todo |

### documentId

UUID of the parent document. **all entities** have this, including `entityType=document` rows. for document rows, `id != documentId` - the `id` is the title block UUID while `documentId` is the document's own UUID.

blocks and pages share the same `documentId` as their parent document, enabling document-level grouping.

### stamp

UUID that changes on each content update. acts as a content version identifier. **this column is UNINDEXED** in FTS5 (not searchable, stored only).

### exactMatchContent

present only for `entityType=document` rows. contains the document title with spaces removed for exact-match searching (e.g. `"craft Discount Codes"` -> `"craftDiscountCodes"`). empty string for blocks and pages.

---

## PlainTextSearch JSON schema

each file is named `document_{documentId}.json` and contains:

```json
{
    "blockCount": 8,
    "contentHash": "17C02ACC1100E14A4682BF356331549D",
    "documentId": "{documentId}",
    "isDailyNote": false,
    "lastViewed": 795611447.428167,
    "markdownContent": "# \n\n#hub #on/brain2 \n\n---\n\n# recurring tasks\n...",
    "modified": 795611491.249674,
    "plainTextContent": "\n#hub #on/brain2 \nrecurring tasks\n...",
    "stamp": "{stamp}",
    "tagSearchContent": "\n#hub #on/brain2 \nrecurring tasks\n...",
    "tags": ["hub", "on/brain2", "type/app"],
    "title": "toolset"
}
```

### fields

| field | type | description |
|-------|------|-------------|
| `blockCount` | int | number of blocks in the document |
| `contentHash` | string | MD5 hash of content for change detection |
| `documentId` | UUID | document ID (matches filename) |
| `isDailyNote` | bool | whether this is a daily note |
| `lastViewed` | float | NSDate timestamp (seconds since 2001-01-01) |
| `markdownContent` | string | **full markdown** including `#tags`, `**bold**`, `[links](url)`, `- [x]` checkboxes, tables, `---` separators |
| `modified` | float | NSDate timestamp of last modification |
| `plainTextContent` | string | stripped plain text (formatting removed, tags preserved) |
| `stamp` | UUID | content version identifier |
| `tagSearchContent` | string | text optimized for tag search (similar to plainText but preserves some case) |
| `tags` | string[] | array of tag strings (without `#` prefix) |
| `title` | string | document title |

timestamps use **NSDate epoch** (2001-01-01 00:00:00 UTC). to convert: add seconds to `2001-01-01`.
example: `795611491.249674` = 2026-03-19 11:11:31 UTC.

114 daily notes found in the main space.

---

## block hierarchy

### within SQLite search index: flat

the search index is **flat** - no parent block ID, no position/order, no nesting depth. blocks are only linked to their parent document via `documentId`. there is no way to reconstruct the block tree from the search index alone.

`customRank` provides **approximate ordering** within a document - blocks sorted by customRank within a single documentId appear in roughly document order (verified on a sample document). but it's a ranking signal, not a positional index.

### within Realm: full hierarchy

the Realm database contains the full block tree with parent-child relationships (the `BlockDataModel` stores block hierarchy). Realm also stores:
- block styling/attributes (indentation level, list style, text style, color, decorations)
- object/database properties (relation links, collection schemas)
- task inbox data
- document share info, comments, contributors
- folder structure (`FolderDataModel`)
- sync state

Realm is binary (MongoDB Realm format) and cannot be queried with sqlite3.

### within PlainTextSearch JSON: serialized markdown

PlainTextSearch has the full markdown content of each document. nesting is implicit via markdown indentation. no per-block IDs or hierarchy data.

---

## document metadata

### what's available locally

| data point | search SQLite | PlainTextSearch JSON | Realm |
|------------|:---:|:---:|:---:|
| document title | content (where entityType=document) | title | yes |
| document ID | documentId | documentId | yes |
| creation date | no | no | yes (likely) |
| modification date | no | modified (NSDate) | yes |
| last viewed date | no | lastViewed (NSDate) | yes |
| folder assignment | no | no | yes (FolderDataModel) |
| tags | no | tags[] | yes |
| is daily note | no | isDailyNote | yes |
| block count | no | blockCount | yes |
| content hash | no | contentHash | yes |
| markdown content | no | markdownContent | yes |
| block hierarchy | no | no (flat markdown) | yes |
| block styles | no | no | yes |

### subpages

subpages (nested page blocks) are represented in the search index with `entityType=page`. they have their own `id` but share the `documentId` of the parent document. their `type` can be `text`, `object`, or `objectList`:
- `text` page (570): regular text subpage
- `object` page (611): database row displayed as a page
- `objectList` page (22): database/collection view

there is **no way to determine which block is the parent of a subpage** from the search index alone.

---

## data completeness

### main space ({spaceId})

| metric | value |
|--------|-------|
| total BlockSearch rows | 46,110 |
| document entities | 1,245 |
| page entities | 1,203 |
| block entities | 43,662 |
| PlainTextSearch files | 1,218 |
| daily notes | 114 |
| blocks per document (avg) | ~35 |

the 1,245 document count matches the expected vault size (~1200-1300 docs). PlainTextSearch has 1,218 files - slightly fewer than the 1,245 in the search index (27 docs may have been deleted or are pending indexing).

### secondary space ({secondarySpaceId})

126 total rows (39 documents). much smaller workspace.

### shared spaces

- Birkenfactory (via main): 1,225 rows (14 documents)
- Birkenfactory (via 1ar): 1,172 rows (14 documents)
- Unknown team (via 1ar): 702 rows (102 documents)

---

## sync timing

the main search index was last modified at **2026-04-06 12:59** (the largest DB). SearchConfig `lastStampCheckDate` = `1775471325` = **2026-04-06 12:28:45 UTC** (Unix epoch). the Realm file for main space was last modified at **2026-04-06 18:32** - much more recent, suggesting Realm updates in near-real-time while the search index may lag or batch-update.

manual test recommended: edit a doc in Craft, then check mtime of both the .realm and .sqlite files to measure the delta.

---

## FTS5 search capabilities

the search index supports full-text search via FTS5 MATCH queries:

```sql
-- search for documents containing "craft"
SELECT id, content, documentId
FROM BlockSearch
WHERE BlockSearch MATCH 'craft'
AND entityType = 'document';

-- search across all blocks
SELECT id, content, type, documentId
FROM BlockSearch
WHERE BlockSearch MATCH 'typescript AND async';
```

tokenizer is `unicode61` (standard Unicode tokenization, no special stemming or CJK support). the `stamp` column is UNINDEXED so it cannot be searched.

**limitation**: all columns except `stamp` are indexed by FTS5, meaning the `id`, `type`, `entityType`, `customRank`, `isTodo`, `isTodoChecked`, and `documentId` columns are treated as searchable text, not as structured data. to filter by entityType you'd need to include it in the MATCH expression or post-filter results. column-targeted FTS queries work: `SELECT ... WHERE BlockSearch MATCH 'entityType:document AND content:craft'`.

---

## gap analysis: local DB vs API

### what local DB gives you that API doesn't

| capability | local | API |
|------------|-------|-----|
| **offline full-text search** | yes (FTS5) | no (requires network) |
| **full markdown content** | yes (PlainTextSearch JSON) | yes |
| **document metadata** (title, modified, tags, isDailyNote) | yes (PlainTextSearch JSON) | yes |
| **instant read, no rate limits** | yes | no (rate limited) |
| **search with ranking** | yes (customRank + FTS5 bm25) | yes (API search) |
| **bulk enumeration** | yes (scan all files/rows) | yes but paginated |
| **tag list per document** | yes (PlainTextSearch JSON) | yes (via block content) |
| **daily note identification** | yes (`isDailyNote` flag) | no (must infer from title) |
| **content hash for change detection** | yes (`contentHash`) | no |
| **last viewed date** | yes (`lastViewed`) | no |
| **reminder data** | yes (Reminders JSON) | no |
| **notification inbox** | yes (NotificationInbox JSON) | no |

### what API gives you that local DB doesn't

| capability | local | API |
|------------|-------|-----|
| **block hierarchy / tree structure** | no (flat in SQLite, binary in Realm) | yes (full block tree) |
| **block-level IDs with parent-child** | no | yes |
| **folder structure** | no (only in Realm binary) | yes |
| **creation date** | no | yes |
| **block-level editing** | no (read-only) | yes |
| **document creation/deletion** | no | yes |
| **collection/database schema** | no | yes |
| **comments** | no | yes |
| **sharing/permissions** | no | yes |

### sweet spot for local DB

1. **fast search** - FTS5 queries are instant, no network round-trip
2. **bulk document enumeration** - iterate all 1218 PlainTextSearch JSONs for analysis, tag inventory, content audits
3. **change detection** - compare contentHash values to detect which docs changed since last sync
4. **daily note discovery** - isDailyNote flag is not available via API
5. **offline reading** - markdownContent in PlainTextSearch gives full document content without API calls
6. **tag analytics** - Tags/ directory has usage frequency data

### things to be aware of

- search index may lag behind Realm by minutes to hours
- PlainTextSearch files may not exist for every document (1218 vs 1245)
- Realm contains the authoritative data but is in binary Realm format (not SQLite)
- the search index is read-only from our perspective - Craft owns it
- opening the database while Craft is running requires read-only mode (`?mode=ro`)
- content in BlockSearch has no markdown formatting - use PlainTextSearch JSON for formatted content
- isTodoChecked=2 means "cancelled" (not documented anywhere obvious)
- shared space databases may have different sync cadence than the main space
