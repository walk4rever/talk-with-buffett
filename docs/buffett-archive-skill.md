# Buffett Archive — Skill

Use this skill to query the Warren Buffett knowledge archive (1957–2024) when answering questions about Buffett's views, decisions, writings, or investment history.

## Base URL

```
https://buffett.air7.fun/api/tools
```

## Tools

### 1. search — find relevant passages

```bash
curl "https://buffett.air7.fun/api/tools/search?q=QUERY&yearFrom=YYYY&yearTo=YYYY&limit=N"
```

| Param | Required | Description |
|-------|----------|-------------|
| `q` | ✅ | Question or topic in any language |
| `yearFrom` | ❌ | Earliest year (inclusive) |
| `yearTo` | ❌ | Latest year (inclusive) |
| `limit` | ❌ | Max results, default 7, max 20 |

Returns: ranked chunks with `year`, `sourceType`, `title`, `excerpt` (English), `excerptZh` (Chinese).

**Use when**: answering questions about Buffett's views, finding what he said about a topic, timeline queries.

### 2. document — read a full document

```bash
curl "https://buffett.air7.fun/api/tools/document?year=YYYY&type=TYPE&page=N"
curl "https://buffett.air7.fun/api/tools/document?sourceId=ID&page=N"
```

| Param | Required | Description |
|-------|----------|-------------|
| `sourceId` | ❌ | Exact source ID (from search results) |
| `year` | ❌ | Document year |
| `type` | ❌ | `shareholder` \| `partnership` \| `annual_meeting` \| `article` \| `interview` |
| `page` | ❌ | Page number, default 1 (10 chunks per page) |

Returns: `source` metadata, `chunks[]`, `totalPages`.

**Use when**: user wants to read a specific letter or document in full.

### 3. graph — entity relationships

```bash
curl "https://buffett.air7.fun/api/tools/graph?entity=ENTITY&yearFrom=YYYY&yearTo=YYYY"
```

| Param | Required | Description |
|-------|----------|-------------|
| `entity` | ✅ | Company, concept, or person name |
| `yearFrom` | ❌ | Earliest year |
| `yearTo` | ❌ | Latest year |
| `limit` | ❌ | Max relationships, default 12 |

Returns: `relationships[]` with `from`, `relation`, `to`, `year`, `quote`.

**Use when**: exploring structured relationships (holdings, acquisitions, concept mentions) around a specific entity.

## Data coverage

| Type | Years | Count |
|------|-------|-------|
| `shareholder` | 1965–2024 | 61 letters |
| `partnership` | 1957–1970 | 33 letters |
| `annual_meeting` | 1985–2024 | 34 transcripts |

## Workflow

1. Start with `search` for most questions — it covers 80% of use cases.
2. Use `document` when the user asks to read a specific letter or wants full context beyond the excerpt.
3. Use `graph` to supplement `search` results with structured relationship data (e.g. when/how long Berkshire held a position).

## Examples

```bash
# What did Buffett say about insurance float?
curl "https://buffett.air7.fun/api/tools/search?q=insurance+float"

# Read the 2008 shareholder letter
curl "https://buffett.air7.fun/api/tools/document?year=2008&type=shareholder"

# When did Berkshire hold Apple?
curl "https://buffett.air7.fun/api/tools/graph?entity=Apple"

# Buffett's views on leverage, 2000–2020
curl "https://buffett.air7.fun/api/tools/search?q=leverage+debt+risk&yearFrom=2000&yearTo=2020"
```
