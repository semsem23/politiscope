-- Retrait de justif et hashtags.
--
-- justif était le dernier champ de jugement resté après le retrait du
-- sentiment (003) : une phrase disant ce qu'il fallait comprendre de la
-- citation. hashtags reprenait tels quels ceux du tweet source, sans lecture
-- humaine. Aucun des deux n'est plus demandé au brouillon : publier revient
-- désormais à choisir une candidate et vérifier son thème, rien de plus.
--
-- Les deux colonnes partent, avec les valeurs déjà saisies : perdues,
-- assumé, plus rien ne les lit.

begin;

alter table entries drop column if exists justif;
alter table entries drop column if exists hashtags;

commit;
