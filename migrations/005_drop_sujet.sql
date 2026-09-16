-- Removal of sujet.
--
-- Last judgment field after sentiment (003) then justif/hashtags (004): a
-- one- or two-word label saying what the citation is about, pre-filled by
-- Claude Haiku and reviewed by hand.
--
-- It duplicated `theme`, which already carries the citation's subject and
-- is, unlike `sujet`, constrained by the `topics` table — so consistent
-- from one entry to another, where `sujet` was free text. The site no
-- longer displayed it anywhere but the graph tooltip and an entry's detail
-- view; both now show the theme instead. Publishing comes down to picking a
-- candidate and checking its theme, nothing more.
--
-- The column goes with the values already entered: lost, accepted, nothing
-- reads them anymore. No index, view, function, or RLS policy depends on it
-- (the 002 policies key on `publie`, not on the columns).

begin;

alter table entries drop column if exists sujet;

commit;
