-- Page /flux (Flux Macron) : articles collectés, journal de collecte, personnalités.
--
-- Trois tables NOUVELLES ; `candidates` et `entries` ne sont pas touchées.
--
--   flux_articles       un article ou une publication réellement collecté(e) qui
--                       mentionne la figure suivie (aujourd'hui : Emmanuel Macron
--                       seulement). Champs bruts : le regroupement en événements,
--                       les statuts et l'indice de recoupement sont calculés à
--                       la lecture par le pipeline du site (web/src/flux/shared).
--   flux_source_runs    un passage de collecte par source, avec son état : c'est
--                       ce qui alimente le panneau « État des sources ».
--   flux_personalities  liste du filtre « Personnalités » (miroir de
--                       flux_personalities.json, synchronisé par `fetch-flux`).
--
-- Lecture publique (tout ce qui est stocké ici est déjà public : titres publiés,
-- publications de comptes publics, URL). Écriture réservée au rôle `postgres`
-- du pipeline, qui contourne RLS : aucune policy d'insertion, de mise à jour ni
-- de suppression n'est créée.

begin;

create table if not exists flux_articles (
  id                  text primary key,            -- 'x:<id du post>' ou 'google_news:<empreinte>'
  figure              text        not null default 'emmanuel-macron',
  source_kind         text        not null check (source_kind in ('x', 'google_news')),
  publisher_name      text        not null,
  title               text        not null,
  excerpt             text,
  url                 text        not null check (url ~ '^https?://'),
  published_at        timestamptz not null,        -- date de PUBLICATION, jamais celle de la collecte
  collected_at        timestamptz not null default now(),
  author_or_account   text,
  original_source_url text check (original_source_url is null or original_source_url ~ '^https?://')
);
create index if not exists flux_articles_figure_published_idx on flux_articles (figure, published_at desc);

create table if not exists flux_source_runs (
  id           bigserial primary key,
  source_kind  text        not null check (source_kind in ('x', 'google_news')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- ok : la source a répondu ; error : échec ; disabled : désactivée volontairement
  -- (GOOGLE_NEWS_ENABLED) ; not_configured : rien à lire (compte absent, aucune ingestion X)
  status       text        not null check (status in ('ok', 'error', 'disabled', 'not_configured')),
  items_seen   integer     not null default 0,      -- éléments lus à la source
  items_kept   integer     not null default 0,      -- retenus (mention réelle, valides)
  items_new    integer     not null default 0,      -- absents de la table avant ce passage
  error        text check (error is null or char_length(error) <= 300)
);
create index if not exists flux_source_runs_source_started_idx on flux_source_runs (source_kind, started_at desc);

create table if not exists flux_personalities (
  id       text primary key,
  name     text   not null,
  aliases  text[] not null default '{}',
  role     text
);

comment on table flux_articles is
  'Articles et publications mentionnant la figure suivie de la page /flux. Alimenté par `politiscope.cli fetch-flux`.';
comment on table flux_source_runs is
  'Journal des passages de collecte de la page /flux, une ligne par source et par passage.';
comment on table flux_personalities is
  'Personnalités du filtre de la page /flux : une mention exacte du nom ou d''un alias les rattache à un événement.';

alter table flux_articles      enable row level security;
alter table flux_source_runs   enable row level security;
alter table flux_personalities enable row level security;

drop policy if exists lecture_publique_flux_articles on flux_articles;
create policy lecture_publique_flux_articles on flux_articles
  for select to anon, authenticated using (true);

drop policy if exists lecture_publique_flux_source_runs on flux_source_runs;
create policy lecture_publique_flux_source_runs on flux_source_runs
  for select to anon, authenticated using (true);

drop policy if exists lecture_publique_flux_personalities on flux_personalities;
create policy lecture_publique_flux_personalities on flux_personalities
  for select to anon, authenticated using (true);

commit;
