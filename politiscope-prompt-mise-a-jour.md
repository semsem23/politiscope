# Politiscope — Prompt de mise à jour des citations

Copie tout le contenu ci-dessous (à partir de « CONTEXTE ») dans une session Claude Code pour lui faire chercher de nouvelles citations politiques et mettre à jour l'application **Politiscope**.

---

## CONTEXTE

Politiscope est une application web publiée (un « artifact ») qui affiche, sous forme de bulles et d'un graphe de sujets, les citations et le sentiment de personnalités politiques françaises. Elle est en ligne ici :

**URL de l'artifact : https://claude.ai/code/artifact/f19d7318-d4a5-446e-ae05-a2cd3acccfdf**

C'est un fichier HTML autonome (une seule page, JS/CSS/données inline). Les citations sont un instantané codé en dur dans un tableau JavaScript `DATA`, daté et sourcé, pas un flux automatisé en direct.

## TA TÂCHE

1. **Récupère le fichier actuellement publié** à l'URL ci-dessus (si tu as l'outil Artifact, utilise son action `read` ; sinon fais un fetch de la page) pour lire le tableau `DATA` existant, la liste `PARTY_CODE`, `TOPIC_SHORT` et `FAMILIES` — afin de ne pas dupliquer une citation déjà présente et de réutiliser les mêmes codes.

2. **Cherche de nouvelles citations réelles et récentes** de personnalités politiques françaises (députés, sénateurs, ministres, président, chefs de parti), en combinant ces sources :
   - **Flux RSS Yahoo France** : `https://fr.news.yahoo.com/rss/france` — récupère-le en premier pour repérer les sujets et personnalités qui font l'actualité. Attention : ce flux est souvent pauvre en substance politique directe (faits divers, culture) ; sers-t'en comme point de départ, pas comme source unique de citations.
   - **Twitter/X** : si tu disposes d'un accès (API, MCP connector, ou outil de navigation), cherche les tweets/déclarations récents des personnalités déjà suivies (liste dans `PARTY_CODE` ci-dessous) ou de nouvelles figures pertinentes. Si tu n'as pas d'accès direct à X, cherche des articles de presse qui rapportent ou citent leurs tweets — ne te connecte pas à X par scraping non autorisé.
   - **Recherche web générale** de l'actualité politique française des derniers jours, pour compléter et vérifier.

3. **Règles strictes anti-fabrication** (non négociables) :
   - N'invente **aucune** citation. Chaque citation doit être une déclaration publique réellement prononcée, trouvée via une recherche que tu as effectuée.
   - Chaque entrée doit inclure l'URL de la source d'où provient la citation.
   - Si tu ne trouves pas assez de matière fiable, ajoute moins d'entrées plutôt que de combler avec des citations approximatives ou paraphrasées.
   - Vise un spectre politique équilibré (pas uniquement un camp).

4. **Construis chaque nouvelle entrée** selon ce schéma exact (même structure que les entrées existantes du tableau `DATA`) :

   ```js
   {
     nom: "Prénom Nom",                     // nom complet
     parti: "Nom du parti — fonction",      // libellé affiché (peut inclure la fonction, ex: "— Premier ministre")
     famille: "majorite",                   // un des 5 ids ci-dessous, voir "Familles politiques"
     theme: "Budget & finances publiques",  // doit correspondre EXACTEMENT à une clé de TOPIC_SHORT (ou une nouvelle, voir note)
     sujet: "Sujet principal en une phrase courte",
     citation: "Citation exacte entre guillemets, fidèle à la source.",
     hashtags: ["#Exemple1", "#Exemple2"],  // 1 à 2 hashtags plausibles liés au sujet
     sentiment: "negatif",                  // "positif" | "neutre" | "negatif" — ton de LA DÉCLARATION, pas jugement sur la personne
     justif: "Une phrase expliquant pourquoi ce ton.",
     date: "13 septembre 2026",             // format "D mois AAAA", "mois AAAA" ou "AAAA" si imprécis
     source: "https://..."                  // URL vérifiable de la citation
   }
   ```

5. **Familles politiques** (id → libellé, utilisées pour la couleur des bulles) :
   - `majorite` → Majorité présidentielle
   - `droite-rep` → Droite républicaine
   - `extreme-droite` → Droite radicale / souverainiste
   - `gauche-radicale` → Gauche radicale
   - `gauche-social` → Gauche social-démocrate / écologiste

6. **Thèmes actuels** (clé `theme` → libellé court affiché dans le graphe des sujets) :
   - `Social & inclusion` → Handicap
   - `Budget & finances publiques` → Budget
   - `Institutions & calendrier électoral` → Institutions
   - `Immigration & sécurité` → Immigration
   - `Pouvoir d'achat & vie chère` → Pouvoir d'achat
   - `Europe & souveraineté` → Europe
   - `Stratégie 2027 & recomposition` → Élection 2027
   - `Climat & écologie` → Climat

   Si une nouvelle citation ne rentre dans aucun thème existant, tu peux créer un nouveau thème : ajoute sa clé dans le tableau `DATA` **et** une entrée correspondante dans l'objet `TOPIC_SHORT` (recherche `TOPIC_SHORT` dans le fichier) avec un libellé court (un mot ou deux) pour le nœud du graphe.

7. **Table des partis** (objet `PARTY_CODE`, utilisée pour la vue « Partis » du graphe) : chaque politicien doit avoir une entrée `"Nom complet": "CodeParti"` dans cet objet (recherche `PARTY_CODE` dans le fichier). Réutilise un code existant si le parti est déjà représenté (ex. `"Renaissance"`, `"RN"`, `"LR"`, `"LFI"`, `"PS"`, `"Écologistes"`, `"Horizons"`, `"UDR"`, `"Reconquête"`, `"DLF"`, `"PCF"`, `"Place Publique"`, `"Debout!"`), sinon crée-en un nouveau court et cohérent.

8. **Insère les nouvelles entrées** dans le tableau `DATA` (ajoute-les, ne supprime ni n'écrase les entrées existantes sauf doublon manifeste de la même citation). Ensuite :
   - Mets à jour la date « Dernière mise à jour » dans le pied de page (`footer.page-footer`).
   - Mets à jour la phrase « constitué le [date] » dans le paragraphe méthodologique (`.methodo`) avec la date du jour de la mise à jour.
   - Si un événement politique majeur s'est produit, ajuste légèrement le paragraphe de contexte électoral (`CONTEXTE` dans le script) — sans réécrire tout le texte, juste l'actualiser.

9. **Vérifie avant de publier** :
   - Le fichier reste un unique fichier HTML autonome (pas de dépendances externes nouvelles).
   - Aucune erreur JavaScript (recharge la page dans un navigateur ou vérifie la console si tu en as la possibilité).
   - Les nouveaux libellés de sujets courts ne débordent pas des bulles du graphe (les sujets longs comme « Pouvoir d'achat » ont déjà une marge prévue dans le code, `marginFor()` dans la fonction `buildGraph` — augmente-la si un nouveau libellé est plus long).

10. **Publie la mise à jour** :
    - Si tu as l'outil Artifact disponible dans ta session : republie le fichier avec `url: "https://claude.ai/code/artifact/f19d7318-d4a5-446e-ae05-a2cd3acccfdf"` pour mettre à jour la page existante (même lien).
    - Si tu n'as pas cet outil (session Claude Code en ligne de commande classique) : sauvegarde le fichier HTML mis à jour et indique clairement à l'utilisateur qu'il doit le republier lui-même via Claude (Cowork/claude.ai) pour que le lien en ligne soit mis à jour.

## Astuce : automatiser ce rafraîchissement

Si ton environnement Claude Code supporte les tâches planifiées (scheduled tasks / triggers), tu peux proposer à l'utilisateur de programmer l'exécution récurrente de ce même prompt (par exemple une fois par semaine) pour que Politiscope reste à jour sans intervention manuelle.
