-- ============================================================================
-- 001_perf_indexes.sql
--
-- Purpose: speed up the hot read paths that make the app feel slow.
--
-- Background
--   The memo list endpoint runs roughly this query:
--
--     SELECT m.*, u.username
--     FROM memo m
--     JOIN user u ON m.creator_id = u.id
--     WHERE m.row_status = ?
--       AND m.id NOT IN (SELECT memo_id FROM memo_relation WHERE type = 'COMMENT')
--       [AND m.creator_id = ?]      -- logged-in user viewing own timeline
--       [AND m.visibility = ?]      -- anonymous visitor browsing public memos
--     ORDER BY m.created_ts DESC
--     LIMIT ? OFFSET ?
--
--   The original schema only has single-column indexes on memo(creator_id),
--   memo(created_ts) and memo_relation(type). With no index covering
--   (filter columns ..., created_ts), SQLite has to walk a large number of
--   candidate rows and then sort them. The two composite indexes below let it
--   read the rows already in ORDER BY order and stop after LIMIT.
--
-- Apply to existing deployments:
--     npx wrangler d1 execute memos --remote --file migrations/001_perf_indexes.sql
--
-- All statements are IF NOT EXISTS, so re-running is safe.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Logged-in timeline: filter by creator + row_status, sort by created_ts.
--    Without this the planner either scans idx_memo_created_ts and discards
--    rows until it finds LIMIT matches for this creator, or scans
--    idx_memo_creator_id and then sorts. Both get slower as history grows.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_memo_creator_rowstatus_created
  ON memo (creator_id, row_status, created_ts DESC);

-- ----------------------------------------------------------------------------
-- 2. Explore / anonymous feed: filter by row_status + visibility, sort by time.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_memo_rowstatus_visibility_created
  ON memo (row_status, visibility, created_ts DESC);

-- ----------------------------------------------------------------------------
-- 3. The list query excludes comment memos with
--      m.id NOT IN (SELECT memo_id FROM memo_relation WHERE type = 'COMMENT')
--    The existing idx_memo_relation_type only covers `type`, so every candidate
--    row forces a lookup back into the table to read memo_id. Making it a
--    covering index lets the subquery be satisfied from the index alone.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_memo_relation_type_memo_id
  ON memo_relation (type, memo_id);

-- ----------------------------------------------------------------------------
-- 4. Per-user aggregation-heavy endpoints (/api/user/:id/stats) repeatedly
--    count/scan rows of one creator restricted to row_status = 'NORMAL'.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_memo_creator_rowstatus
  ON memo (creator_id, row_status);

-- ----------------------------------------------------------------------------
-- 5. Foreign-key lookups that currently trigger full scans:
--      - memo_tag is joined by memo_id on every list request
--      - memo_resource likewise
--      - user_setting is looked up by user_id on each authenticated request
--    Note: memo_tag / memo_resource have a composite PRIMARY KEY of
--    (memo_id, ...) so a leading memo_id prefix is already indexed; this entry
--    is listed for completeness and is a no-op where already covered.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_setting_user_id
  ON user_setting (user_id);

CREATE INDEX IF NOT EXISTS idx_shortcut_creator_id_rowstatus
  ON shortcut (creator_id);


-- ============================================================================
-- Verify the planner picks the new indexes, e.g.:
--
--   npx wrangler d1 execute memos --remote --command \
--     "EXPLAIN QUERY PLAN SELECT m.* FROM memo m \
--      WHERE m.row_status='NORMAL' AND m.creator_id=1 \
--      ORDER BY m.created_ts DESC LIMIT 16"
--
-- You want to see "SEARCH m USING INDEX idx_memo_creator_rowstatus_created"
-- and no "USE TEMP B-TREE FOR ORDER BY" line.
-- ============================================================================
