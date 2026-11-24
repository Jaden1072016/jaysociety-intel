-- On the first run every Twitch top category looked "new", producing category-only ideas. Hide them.
UPDATE "opportunities" SET "status" = 'dismissed'
WHERE "created_at" < '2026-11-24T03:30:00Z' AND "status" = 'new'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements("evidence") e WHERE e->>'kind' <> 'twitch_top');
