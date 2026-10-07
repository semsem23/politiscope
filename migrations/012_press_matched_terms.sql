-- Flux live : retenue sur le sujet seul.
--
-- Les entités (personnalités, pays) disparaissent comme critère : elles sont
-- désormais des termes du lexique de sujets (politiscope/media.py). Un article
-- est retenu dès qu'un sujet est trouvé dans son titre.
--
--   matched_terms  libellés du lexique trouvés dans le titre (« Macron » est
--                  rendu « Emmanuel Macron ») ; vide pour un article lié qui
--                  a hérité du sujet de son cluster
--   theme          désormais nullable : les articles sans sujet sont stockés
--                  aussi, pour être re-tagués quand le lexique évolue. Le
--                  front ne lit que les lignes où theme n'est pas null.
--
-- `entities` est supprimée. Les lignes existantes gardent leur ancien sujet
-- jusqu'au re-tag : `python scripts/retag_media.py --apply`.

begin;

alter table press_mentions
  add column if not exists matched_terms text[] not null default '{}';

alter table press_mentions drop constraint if exists press_mentions_entities_check;
alter table press_mentions drop column if exists entities;

alter table press_mentions alter column theme drop not null;

commit;
