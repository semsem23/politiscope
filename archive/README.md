# Archive

## politiscope.html

Version d'origine du baromètre : un fichier HTML autonome, données `DATA`
codées en dur, publié comme artifact Claude à l'adresse
`https://claude.ai/code/artifact/f19d7318-d4a5-446e-ae05-a2cd3acccfdf`.

**Remplacé par le site React** (`web/`), qui lit les mêmes citations depuis
Supabase et se met donc à jour sans réédition du code.

Ce fichier reste ici pour deux raisons :

- l'artifact publié est toujours en ligne à son URL et fait foi pour ce qui a
  été diffusé à cette date ;
- ses 26 entrées ont servi de source au chargement initial de la table
  `entries` (voir `scripts/extract_artifact_data.mjs`).

Ne plus l'éditer : toute modification du contenu passe désormais par Supabase.
