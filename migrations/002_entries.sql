-- Entrées éditorialisées : ce que le site affiche réellement.
--
-- À distinguer de `candidates`, qui est la matière brute sortie de l'ingestion.
-- Une entrée porte un jugement humain (sentiment, justification, thème retenu)
-- qu'aucune heuristique ne produit ; c'est la table que lit le front React.

begin;

create table if not exists topics (
  theme          text primary key,   -- clé longue, ex. « Budget & finances publiques »
  libelle_court  text not null,      -- étiquette du graphe, ex. « Budget »
  ordre          int  not null default 100
);

create table if not exists entries (
  id            bigserial primary key,
  nom           text not null,
  parti         text not null,       -- libellé affiché, fonction comprise
  code_parti    text,                -- code court pour la vue « Partis » du graphe
  famille       text not null check (famille in (
                   'majorite','droite-rep','extreme-droite',
                   'gauche-radicale','gauche-social')),
  theme         text not null references topics(theme),
  sujet         text not null,
  citation      text not null,
  citation_key  text not null,
  hashtags      text[] not null default '{}',
  sentiment     text not null check (sentiment in ('positif','neutre','negatif')),
  justif        text not null,
  date_texte    text not null,       -- « 13 septembre 2026 », tel qu'affiché
  date_tri      date,                -- même date, triable
  source        text not null,
  candidate_id  bigint references candidates(id) on delete set null,
  publie        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (nom, citation_key),
  constraint source_https check (source like 'https://%')
);

create index if not exists entries_famille_idx   on entries (famille);
create index if not exists entries_theme_idx     on entries (theme);
create index if not exists entries_sentiment_idx on entries (sentiment);
create index if not exists entries_date_idx      on entries (date_tri desc nulls last);

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists entries_touch on entries;
create trigger entries_touch before update on entries
  for each row execute function touch_updated_at();

-- Le site est public : lecture ouverte, écriture réservée au pipeline.
alter table topics  enable row level security;
alter table entries enable row level security;

drop policy if exists lecture_publique_topics on topics;
create policy lecture_publique_topics on topics
  for select to anon, authenticated using (true);

drop policy if exists lecture_publique_entries on entries;
create policy lecture_publique_entries on entries
  for select to anon, authenticated using (publie);

commit;
