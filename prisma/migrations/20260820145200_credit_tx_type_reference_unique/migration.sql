-- Concurrent charge idempotency: at most one row per (type, referenceId).
-- PostgreSQL UNIQUE allows multiple NULLs for referenceId (transactions without a ref).
CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_type_referenceId_key" ON "CreditTransaction"("type", "referenceId");
