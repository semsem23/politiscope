-- Restrict public read access to editorial content only.
--
-- 001 granted `anon`/`authenticated` blanket `select` on accounts, tweets,
-- rss_items, candidates and publications, on the theory that these are
-- "public declarations anyway". But candidates carries unreviewed press
-- leads (rss_items.media_url, candidates rows scored but never checked by a
-- human) and the publishable key ships in the JS bundle -- anyone can read
-- those tables directly via PostgREST with no server in front of them.
-- `entries` (gated on `publie`) is the only table meant to be public.
--
-- This drops the five `lecture_publique_*` policies from 001. RLS was
-- already enabled on every one of these tables, so removing their only
-- select policy makes them default-deny for anon/authenticated -- no grant
-- statement needed. The `postgres` role the pipeline connects with bypasses
-- RLS entirely, so ingestion and publishing are unaffected.
--
-- entries and topics keep their 002 policies untouched: entries stays
-- filtered on `publie`, topics stays fully public (it's just a label
-- lookup, nothing editorial to protect).

begin;

drop policy if exists lecture_publique_accounts     on accounts;
drop policy if exists lecture_publique_tweets        on tweets;
drop policy if exists lecture_publique_rss_items     on rss_items;
drop policy if exists lecture_publique_candidates    on candidates;
drop policy if exists lecture_publique_publications  on publications;

-- --- personnalites: close the RLS-bypass gap on the same pass ------------
--
-- 006 created this view without `security_invoker`, so it runs with its
-- owner's privileges (the migration role) and ignores RLS on `entries`
-- entirely. It's not exploitable today only because its own query already
-- filters `where e.publie` by hand -- the 006 comment says as much. That's
-- one WHERE clause away from leaking unpublished entries the next time
-- someone edits the view and forgets it. security_invoker makes the view
-- re-check RLS on `entries` as the calling role, same as querying the table
-- directly, so that filter stops being the only thing standing between
-- unpublished entries and the anon key.
--
-- This is fixed here rather than by editing 006_add_figures.sql in place:
-- db-migrate tracks applied files by filename only (schema_migrations),
-- and 006 has already run against production via nightly ingestion, so an
-- in-place edit to it would never be picked up. ALTER VIEW ... SET, rather
-- than a full CREATE OR REPLACE, avoids re-stating (and risking drift from)
-- 006's view definition and leaves its existing grants untouched.
alter view if exists personnalites set (security_invoker = true);

commit;
