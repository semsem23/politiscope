-- Mentions presse de la vue « Flux live ».
--
-- Une ligne par article du Monde, du Figaro ou du Parisien qui cite au moins
-- une entité suivie par la vue (exécutif français, dirigeants étrangers et
-- leurs pays) et relève d'un de ses six sujets. Source : les flux RSS publics
-- des trois rédactions — gratuits, sans clé (voir politiscope/media.py).
--
-- Incrémental : `fetch-media` tourne chaque nuit, ne lit que ce que les flux
-- exposent à ce moment-là (leurs derniers articles), et n'ajoute que les
-- articles absents (clé = URL de l'article). L'historique s'accumule donc
-- depuis le premier passage ; la période 24h / 7j / 30j de la vue filtre cet
-- historique côté client.
--
-- Lecture publique, contrairement à rss_items (007) : ce ne sont pas des
-- pistes à vérifier mais des titres déjà publiés par les rédactions, avec
-- le lien vers leur article — exactement ce que la vue affiche.

begin;

create table if not exists media_mentions (
  id            text primary key,               -- URL canonique de l'article
  outlet        text        not null check (outlet in ('lemondefr', 'Le_Figaro', 'le_Parisien')),
  published_at  timestamptz not null,
  titre         text        not null,
  resume        text,
  article_url   text        not null,
  theme         text        not null,
  entities      text[]      not null check (cardinality(entities) > 0),
  ingested_at   timestamptz not null default now()
);
create index if not exists media_mentions_published_idx on media_mentions (published_at desc);

comment on table media_mentions is
  'Articles de presse (RSS Le Monde / Le Figaro / Le Parisien) mentionnant une '
  'entité de la vue Flux live. Alimenté par `politiscope.cli fetch-media`.';

alter table media_mentions enable row level security;

drop policy if exists lecture_publique_media_mentions on media_mentions;
create policy lecture_publique_media_mentions on media_mentions
  for select to anon, authenticated using (true);

commit;
