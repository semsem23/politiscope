-- Flux live : une seule source, Google Actualités (rubrique « France –
-- Dernières infos »), à la place des flux RSS du Monde, du Figaro et du
-- Parisien.
--
-- Chaque article d'un cluster Google est une mention, avec son éditeur réel :
--   publisher   éditeur de l'article (« Le Monde.fr », « BFM », …)
--   via         canal de collecte : « Google Actualités » pour les nouvelles
--               lignes, « RSS de la rédaction » pour l'historique (009)
--   cluster_id  id de l'article principal du cluster Google ; null pour
--               l'historique
--
-- `outlet` devient le canal ('google_news'). Le CHECK est recréé NOT VALID :
-- Postgres ne revérifie pas les lignes existantes. Les trois valeurs
-- historiques y restent autorisées malgré tout, car un CHECK NOT VALID
-- s'applique quand même à toute ligne modifiée — sans elles, re-taguer
-- l'historique (scripts/retag_media.py) échouerait.

begin;

alter table press_mentions
  add column if not exists publisher  text,
  add column if not exists via        text,
  add column if not exists cluster_id text;

update press_mentions
   set publisher = case outlet
                     when 'lemondefr'   then 'Le Monde'
                     when 'Le_Figaro'   then 'Le Figaro'
                     when 'le_Parisien' then 'Le Parisien'
                     else outlet
                   end
 where publisher is null;

update press_mentions set via = 'RSS de la rédaction' where via is null;

alter table press_mentions
  alter column publisher set not null,
  alter column via       set not null;

alter table press_mentions drop constraint if exists press_mentions_outlet_check;
alter table press_mentions add constraint press_mentions_outlet_check
  check (outlet in ('google_news', 'lemondefr', 'Le_Figaro', 'le_Parisien')) not valid;

comment on table press_mentions is
  'Articles de presse de la vue Flux live : Google Actualités (rubrique France), '
  'un article par éditeur de chaque cluster ; historique 009 = RSS Le Monde / '
  'Le Figaro / Le Parisien. Alimenté par `politiscope.cli fetch-media`.';

commit;
