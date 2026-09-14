-- Politiscope — schéma initial
-- Remplace x_state.json / x_tweets.jsonl / rss_items.jsonl par un stockage durable.
--
-- Le pipeline écrit via le rôle `postgres` (connexion directe), qui contourne RLS.
-- RLS est activé pour que la clé publishable ne donne qu'un accès en LECTURE :
-- ces données sont des déclarations publiques, mais nul ne doit pouvoir y écrire.

begin;

-- --- personnalités suivies ------------------------------------------------
create table if not exists accounts (
  handle      text primary key,
  nom         text        not null unique,
  famille     text        not null check (famille in (
                 'majorite','droite-rep','extreme-droite',
                 'gauche-radicale','gauche-social')),
  parti       text        not null,
  user_id     text,                    -- id X, résolu une fois puis mis en cache
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on column accounts.user_id is
  'Identifiant numérique X. Résolu une seule fois (0,010 $/profil) puis réutilisé.';

-- --- état d''ingestion incrémentale ---------------------------------------
create table if not exists ingest_state (
  handle         text primary key references accounts(handle) on delete cascade,
  last_tweet_id  text,                 -- since_id du prochain appel
  updated_at     timestamptz not null default now()
);

comment on table ingest_state is
  'since_id par compte : c''est ce qui évite de repayer la lecture des mêmes tweets.';

-- --- tweets bruts ---------------------------------------------------------
create table if not exists tweets (
  id           text primary key,       -- id X, garantit l''idempotence
  handle       text        not null references accounts(handle) on delete cascade,
  created_at   timestamptz not null,
  texte        text        not null,
  lang         text,
  metrics      jsonb,
  source       text        not null,   -- https://x.com/<handle>/status/<id>
  ingested_at  timestamptz not null default now()
);
create index if not exists tweets_created_idx        on tweets (created_at desc);
create index if not exists tweets_handle_created_idx on tweets (handle, created_at desc);

-- --- items Google Actualités ----------------------------------------------
create table if not exists rss_items (
  id            text primary key,
  nom           text        not null,
  titre         text        not null,
  published_at  timestamptz,
  media         text,
  media_url     text,
  google_link   text,                  -- redirection chiffrée : jamais citable
  ingested_at   timestamptz not null default now()
);
create index if not exists rss_published_idx on rss_items (published_at desc);

comment on column rss_items.google_link is
  'Redirection news.google.com à identifiant chiffré : ne se résout pas côté '
  'serveur. Ne jamais l''utiliser comme source ; retrouver l''URL du média.';

-- --- citations candidates -------------------------------------------------
create table if not exists candidates (
  id             bigserial primary key,
  origine        text        not null check (origine in ('x','rss')),
  nom            text        not null,
  famille        text,
  parti          text,
  citation       text        not null,
  citation_key   text        not null,  -- forme normalisée, pour le dédoublonnage
  date           timestamptz,
  source         text,                  -- non nul si et seulement si verifie
  media          text,
  theme_suggere  text,
  protocolaire   boolean     not null default false,
  verifie        boolean     not null default false,
  score          int         not null,
  pourquoi       jsonb,
  tweet_id       text references tweets(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (nom, citation_key),
  -- Invariant central : une candidate vérifiée porte toujours une URL directe.
  constraint verifie_exige_source check (not verifie or source is not null)
);
create index if not exists candidates_score_idx on candidates (score desc);
create index if not exists candidates_date_idx  on candidates (date desc);
create index if not exists candidates_pub_idx   on candidates (verifie, protocolaire, date desc);

-- --- citations effectivement publiées dans l''artifact ---------------------
create table if not exists publications (
  id            bigserial primary key,
  candidate_id  bigint references candidates(id) on delete set null,
  nom           text        not null,
  citation_key  text        not null unique,
  published_at  timestamptz not null default now(),
  note          text
);

comment on table publications is
  'Ce qui est déjà dans DATA. Sert à ne jamais reproposer une citation publiée.';

-- --- journal des passages et de la dépense --------------------------------
create table if not exists ingest_runs (
  id          bigserial primary key,
  kind        text        not null check (kind in ('x','rss')),
  started_at  timestamptz not null default now(),
  items       int         not null default 0,
  reads       int         not null default 0,
  cost_usd    numeric(10,4) not null default 0
);
create index if not exists ingest_runs_started_idx on ingest_runs (started_at desc);

-- --- RLS : lecture publique, écriture réservée au pipeline ----------------
alter table accounts     enable row level security;
alter table ingest_state enable row level security;
alter table tweets       enable row level security;
alter table rss_items    enable row level security;
alter table candidates   enable row level security;
alter table publications enable row level security;
alter table ingest_runs  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','tweets','rss_items','candidates','publications']
  loop
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      'lecture_publique_' || t, t);
  end loop;
end $$;

-- ingest_state et ingest_runs restent sans policy : invisibles via la clé
-- publishable. Ce sont des données d''exploitation, pas du contenu éditorial.

commit;
