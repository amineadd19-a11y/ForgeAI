# ForgeAI Real RAG Architecture (Design)

Status: **design only** — not implemented until vector storage is verified.

## Goal

Document-grounded answers with **citations**, **ownership**, and **tenant isolation**.
No keyword-only “fake RAG”.

## Storage decision

| Option | Fit | Notes |
|--------|-----|--------|
| **pgvector on existing Postgres** | Preferred | Same `DATABASE_URL`, Prisma + raw SQL for vector ops |
| External vector DB (Pinecone, etc.) | Alternative | Extra secrets, ops, egress |
| In-memory / JSON embeddings | Rejected | Not production, not durable |

### Gate before implementation

1. Confirm production Postgres supports the `vector` extension (`CREATE EXTENSION vector`).
2. Run extension enable on a **staging** database first.
3. If extension is unavailable (restricted managed plan), **stop** — do not ship keyword search labeled as RAG.

## Data model (proposed)

```
Document
  id, userId (owner), title, mimeType, byteSize, status (PENDING|INDEXED|FAILED)
  contentHash, createdAt, updatedAt, deletedAt

DocumentChunk
  id, documentId, userId (denormalized for RLS-style filters)
  ordinal, content, tokenCount
  embedding vector(N)   -- N fixed by embedding model (e.g. 1536)
  metadata Json (page, section)

DocumentAcl (optional multi-user later)
  documentId, subjectType (user|team), subjectId, permission (read|write|admin)
```

**Tenant isolation:** every query includes `userId = auth.userId` (or ACL join). Never global search.

## Pipeline

1. **Ingest** — authenticated upload; store blob in object storage (S3) or DB for small text; compute content hash; enqueue index job.
2. **Chunk** — fixed-size overlapping chunks (e.g. 500–800 tokens, 10% overlap); strip secrets patterns.
3. **Embed** — provider embedding API; store vectors; record model + dimensions in metadata.
4. **Retrieve** — `ORDER BY embedding <=> query_embedding LIMIT k` with `userId` filter; optional hybrid BM25 later.
5. **Generate** — inject top-k chunks into context with source ids; require model to cite `[doc:chunk]`.
6. **Cite** — response includes `sources: [{ documentId, chunkId, snippet }]`.
7. **Delete / reindex** — soft-delete document → hard-delete chunks + embeddings; reindex replaces chunks transactionally.

## Security

- Auth required for ingest/search/delete.
- No cross-tenant vector search.
- Prompt injection: treat retrieved text as untrusted data, not instructions.
- Rate-limit ingest and embed calls; charge credits for embedding + generation.
- Never log full document bodies in AI request traces.

## Implementation order (when unblocked)

1. Migration: extension + tables (no public API yet).
2. Ingest + chunk + embed worker.
3. `/api/v1/rag/query` with citations.
4. Playground integration.

Until the extension gate passes, **do not implement** partial RAG.
