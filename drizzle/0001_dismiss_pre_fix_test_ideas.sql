-- Ideas created by the first production self-test used headline-based relevance that let
-- unrelated sports stories through. Hide them; their trends are re-scored on the next refresh.
UPDATE "opportunities" SET "status" = 'dismissed' WHERE "created_at" < '2026-11-24T02:00:00Z' AND "status" = 'new';
