-- Stable figure identity, plus a per-figure aggregate view.
--
-- Until now `entries` only carried a free-text `nom`. `accounts.handle` (the
-- X handle) is the pipeline's real identity key -- `accounts.nom` is unique,
-- and every candidate/entry's `nom` is copied from that registry at
-- ingestion time -- but it was never carried through to `entries` itself, so
-- any front end grouping citations by name alone risked splitting one person
-- into two on a spelling inconsistency.
--
-- `entries.handle` closes that gap. It's nullable: an entry whose `nom`
-- doesn't match any row in `accounts` (retired/renamed account, manual edit,
-- typo) keeps `handle` null rather than blocking publication -- consumers
-- fall back to grouping by `nom` for those via `coalesce(handle, nom)`.

begin;

alter table entries add column if not exists handle text references accounts(handle) on delete set null;

update entries e
   set handle = a.handle
  from accounts a
 where e.handle is null
   and a.nom = e.nom;

create index if not exists entries_handle_idx on entries (handle);

-- One row per figure: their most recent citation, plus how many they have.
-- Powers the front end's Personnalités card grid so it doesn't need to
-- de-duplicate citations by name itself.
--
-- security_invoker: without it the view runs with its owner's privileges
-- and ignores RLS on `entries` -- the `where e.publie` below is then the
-- only thing keeping unpublished entries out of it. With it, the view
-- re-checks RLS on `entries` as the calling role too, so that WHERE clause
-- stops being a single point of failure. (This only fixes fresh installs --
-- see 007_restrict_public_read.sql for why an environment that already ran
-- this migration needs the separate ALTER VIEW there instead.)
create or replace view personnalites
  with (security_invoker = true) as
select distinct on (coalesce(e.handle, e.nom))
       coalesce(e.handle, e.nom) as figure_id,
       e.handle,
       e.nom,
       e.parti,
       e.code_parti,
       e.famille,
       e.theme        as dernier_theme,
       e.citation     as derniere_citation,
       e.date_texte   as derniere_date_texte,
       e.date_tri     as derniere_date_tri,
       e.source       as derniere_source,
       e.id           as derniere_entry_id,
       count(*) over (partition by coalesce(e.handle, e.nom)) as nb_citations
  from entries e
 where e.publie
 order by coalesce(e.handle, e.nom), e.date_tri desc nulls last, e.id desc;

comment on view personnalites is
  'One row per figure -- latest citation and citation count -- for the '
  'Personnalités card grid. Filters `publie` itself rather than relying on '
  'RLS pass-through: a view runs with its owner''s privileges, so RLS on '
  'the base table alone would not reliably keep unpublished entries out of '
  'it.';

grant select on personnalites to anon, authenticated;

commit;
