-- Retrait du sentiment.
--
-- Le baromètre demandait trois jugements par citation : le thème, le sujet, et
-- le ton. Le ton était le plus coûteux à rendre — il fallait trancher entre
-- positif, neutre et négatif sur des déclarations qui sont souvent les trois à
-- la fois — pour un gain de lecture faible : la famille politique porte déjà la
-- couleur, et `justif` dit ce qu'il faut comprendre de la citation.
--
-- La colonne part donc, avec sa contrainte et son index. Les valeurs déjà
-- saisies sont perdues : c'est assumé, elles ne sont plus lues nulle part.

begin;

alter table entries drop column if exists sentiment;

commit;
