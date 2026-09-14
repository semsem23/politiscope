"""Extraction et notation des citations candidates.

Le cœur du pipeline : transformer un titre de presse ou un tweet en une
citation exploitable, ou bien le rejeter. Volontairement conservateur —
il vaut mieux écarter une bonne citation que d'en fabriquer une mauvaise.

Deux pièges que ce module traite explicitement :

1. *Appariement des guillemets.* « Pour les "Verts" … est une "lubie xénophobe" »
   contient deux paires. Un regex naïf avec contrainte de longueur saute la
   première paire (trop courte) et capture le texte qui sépare les deux — une
   citation qui n'a jamais existé. On apparie donc positionnellement d'abord,
   on filtre par longueur ensuite.

2. *Attribution à un tiers.* Un élu cite très souvent quelqu'un d'autre :
   « … », a dit Raphaël Glucksmann. Attribuer ces mots au titulaire du compte
   serait une fabrication. Toute citation accompagnée du nom propre d'un tiers
   est écartée.
"""
from __future__ import annotations

import re
import unicodedata

MIN_QUOTE_CHARS = 25
MIN_QUOTE_WORDS = 4      # « Adieu esprit de défaite » est une citation valide
MIN_TWEET_WORDS = 8

# Un titre qui n'est qu'une question ou une annonce d'agenda n'a pas de valeur.
_NOISE = re.compile(
    r"\b(revoir|replay|en direct|direct|suivez|live|sondage|agenda|à ne pas manquer"
    r"|vidéo|podcast|notre sélection|on vous résume|abonnez-vous)\b",
    re.IGNORECASE,
)

# Marqueurs d'une déclaration réellement rapportée.
_ATTRIBUTION = re.compile(
    r"\b(déclare|affirme|assure|estime|juge|dénonce|martèle|lance|prévient|regrette"
    r"|réclame|plaide|alerte|accuse|promet|répond|insiste|défend|selon|a dit|a lancé)\b",
    re.IGNORECASE,
)

# « Ressemble à une phrase » plutôt que « contient un verbe » : un pronom ou une
# négation est un signal de phrase bien plus fiable en français qu'une liste de
# terminaisons verbales. Distingue « Notre pays s'effondre de l'intérieur »
# (phrase) de « Participation au redressement des finances publiques » (syntagme).
_SENTENCEISH = re.compile(
    r"(\b(je|j'|tu|il|elle|on|nous|vous|ils|elles|se|s'|me|m'|te|c'est|ce|cela|ça)\b"
    r"|\b(ne|n'|pas|plus|jamais|rien|aucun)\b"
    r"|\b(est|sont|sera|seront|était|étaient|ont|avait|avons|avez|fait|font|faut"
    r"|veux|veut|veulent|dois|doit|doivent|peux|peut|peuvent|vais|va|vont|suis"
    r"|sommes|êtes|reste|restent)\b"
    # `(?<!em)ent` : « veulent » est un verbe, « redressement » un substantif.
    r"|\b\w+(ons|ez|rai|ra|rons|ront|ais|ait|aient)\b"
    r"|\b\w+(?<!em)ent\b)",
    re.IGNORECASE,
)

# Prénom Nom (avec particules et traits d'union) — sert au test d'attribution tierce.
_PROPER = re.compile(
    r"\b([A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’\-]+)\s+((?:de |du |d'|le |la )?[A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’\-]+)"
)

_URL = re.compile(r"https?://\S+")
_HASHTAG = re.compile(r"#\w+")
_MENTION = re.compile(r"@\w+")


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalise(s: str) -> str:
    """Clé de comparaison : sert à détecter les doublons entre sources."""
    s = _strip_accents(s.lower())
    return re.sub(r"[^a-z0-9]+", "", s)


def _words(s: str) -> int:
    return len([w for w in re.split(r"\s+", s.strip()) if w])


# --- appariement des guillemets -----------------------------------------
def _pairs_directional(text: str, opener: str, closer: str) -> list[tuple[int, int]]:
    spans, i = [], 0
    while True:
        a = text.find(opener, i)
        if a < 0:
            break
        b = text.find(closer, a + 1)
        if b < 0:
            break
        spans.append((a + 1, b))
        i = b + 1
    return spans


def _pairs_symmetric(text: str, ch: str) -> list[tuple[int, int]]:
    idx = [i for i, c in enumerate(text) if c == ch]
    return [(idx[k] + 1, idx[k + 1]) for k in range(0, len(idx) - 1, 2)]


def quoted_spans(text: str) -> list[str]:
    """Tous les segments entre guillemets, appariés positionnellement.

    Aucun filtrage de longueur ici : c'est précisément ce filtrage prématuré
    qui faisait déraper l'appariement.
    """
    spans: list[tuple[int, int]] = []
    spans += _pairs_directional(text, "«", "»")
    spans += _pairs_directional(text, "“", "”")   # “ ”
    # Les guillemets droits sont symétriques : on les apparie deux à deux, mais
    # seulement en dehors des zones déjà couvertes ci-dessus.
    covered = {i for a, b in spans for i in range(a - 1, b + 1)}
    if not any(i in covered for i, c in enumerate(text) if c == '"'):
        spans += _pairs_symmetric(text, '"')

    out = []
    for a, b in sorted(spans):
        q = " ".join(text[a:b].split()).strip(" :–—-")
        if q:
            out.append(q)
    return out


def extract_quotes(text: str) -> list[str]:
    """Segments cités retenus comme citations plausibles, du plus long au plus court."""
    seen, out = set(), []
    for q in quoted_spans(text):
        if len(q) < MIN_QUOTE_CHARS or _words(q) < MIN_QUOTE_WORDS:
            continue
        if not _SENTENCEISH.search(q):
            continue
        k = normalise(q)
        if k and k not in seen:
            seen.add(k)
            out.append(q)
    return sorted(out, key=len, reverse=True)


# --- attribution ---------------------------------------------------------
def _name_tokens(nom: str) -> set[str]:
    return {normalise(t) for t in nom.split() if len(t) > 2}


_OPENERS = ("«", "“", '"')


def _has_dangling_quote(text: str) -> bool:
    """Un guillemet ouvrant sans fermeture : citation coupée par la troncature."""
    return bool(_OPENERS_RE.search(text)) and not quoted_spans(text)


_OPENERS_RE = re.compile(r"[«“\"]")

# « Prénom Nom : » ou « 🗣️ Prénom Nom : » en tête = propos rapportés d'un tiers.
_REPORTED_LEAD = re.compile(
    r"^\W{0,4}[A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’\-]+\s+[A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’\-]+\s*[::]"
)


def third_party_attribution(text: str, quote: str, owner: str) -> str | None:
    """Renvoie le nom du tiers si la citation semble être de quelqu'un d'autre.

    On retire la citation du texte, puis on cherche un « Prénom Nom » dans ce
    qui reste. Si ce nom n'est pas celui du titulaire du compte, la citation
    lui est probablement attribuée — donc pas de lui.
    """
    remainder = text.replace(quote, " ")
    own = _name_tokens(owner)
    for m in _PROPER.finditer(remainder):
        cand = f"{m.group(1)} {m.group(2)}".strip()
        toks = _name_tokens(cand)
        if not toks or toks & own:
            continue
        # Évite les faux positifs sur les noms d'institutions courants.
        if normalise(cand) in {
            "assembleenationale", "republiquefrancaise", "unioneuropeenne",
            "conseildetat", "premierministre", "presidentdelarepublique",
        }:
            continue
        return cand
    return None



# --- substance politique -------------------------------------------------
# Les clés correspondent exactement aux thèmes de TOPIC_SHORT dans l'artifact.
THEME_LEXICON: dict[str, tuple[str, ...]] = {
    "Budget & finances publiques": (
        "budget", "déficit", "dette", "finances publiques", "impôt", "impôts", "fiscal",
        "fiscalité", "taxe", "dépense publique", "49.3", "plf", "milliards", "cotisation"),
    "Immigration & sécurité": (
        "immigration", "immigré", "migrant", "frontière", "expulsion", "aide médicale", "ofpra",
        "droit du sol", "naturalisation", "sécurité", "délinquance", "narcotrafic",
        "police", "terrorisme", "remigration", "clandestin", "drogue", "protoxyde"),
    "Pouvoir d'achat & vie chère": (
        "pouvoir d'achat", "vie chère", "inflation", "salaire", "smic", "carburant",
        "facture", "énergie", "logement", "loyer", "hlm", "retraite", "pension"),
    "Institutions & calendrier électoral": (
        "constitution", "référendum", "dissolution", "motion de censure", "assemblée",
        "sénat", "proportionnelle", "institution", "mandat", "scrutin", "élection",
        "cohabitation", "vᵉ république", "démission"),
    "Europe & souveraineté": (
        "europe", "européen", "union européenne", "bruxelles", "otan", "souveraineté",
        "ukraine", "mercosur", "euro", "frontex"),
    "Climat & écologie": (
        "climat", "climatique", "écologie", "écologique", "carbone", "canicule",
        "pesticide", "biodiversité", "nucléaire", "renouvelable", "transition"),
    "Stratégie 2027 & recomposition": (
        "2027", "présidentielle", "candidature", "candidat", "primaire", "union de la gauche",
        "front républicain", "campagne", "alliance", "rassemblement", "camp"),
    "Inégalités & fiscalité": (
        "inégalité", "inégalités", "riches", "milliardaire", "fortune", "isf", "patrimoine",
        "partage des richesses", "pauvreté", "précarité", "sécession"),
    "Social & inclusion": (
        "handicap", "accessibilité", "inclusion", "école", "hôpital", "santé", "aide sociale",
        "service public", "éducation", "enseignant", "soignant"),
}

# Messages de circonstance : sincères, mais sans valeur pour un baromètre politique.
_CEREMONIAL = re.compile(
    r"\b(merci|remercie|félicitations|félicite|bravo|hommage|condoléances"
    r"|bonne année|joyeux|meilleurs vœux|anniversaire|repose en paix|bienvenue"
    r"|bon rétablissement|coupe du monde|les bleus|les bleues|médaille|champion"
    r"|toutes mes pensées|solidarité avec les familles)\b",
    re.IGNORECASE,
)


def detect_theme(text: str) -> str | None:
    """Thème dominant du texte, ou None si aucun sujet politique identifié."""
    low = _strip_accents(text.lower())
    best, best_n = None, 0
    for theme, words in THEME_LEXICON.items():
        # Frontières de mot obligatoires : sans elles, « ame » matcherait
        # « ameliorer » et « euro » matcherait « europeen ».
        n = sum(1 for w in words
                if re.search(r"(?<!\w)" + re.escape(_strip_accents(w)) + r"(?!\w)", low))
        if n > best_n:
            best, best_n = theme, n
    return best


def is_ceremonial(text: str) -> bool:
    return bool(_CEREMONIAL.search(text))


# --- nettoyage -----------------------------------------------------------
def clean_tweet(text: str) -> str:
    """Retire URLs, hashtags de fin et mentions d'ouverture d'un tweet."""
    t = _URL.sub("", text)
    t = t.replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&")
    t = re.sub(r"(?:\s*" + _HASHTAG.pattern + r")+\s*$", "", t)
    t = re.sub(r"^(?:" + _MENTION.pattern + r"\s+)+", "", t)
    return " ".join(t.split()).strip()


# --- notation ------------------------------------------------------------
def score_candidate(text: str, *, is_tweet: bool, has_quote: bool) -> tuple[int, list[str]]:
    """Note de 0 à 100 + raisons. Sert à trier ce qu'un humain relira en premier.

    Principe de classement : ce qui est *vérifiable* prime sur ce qui est
    seulement *bien formulé*. Un tweet est verbatim par construction et porte
    une URL directe ; un titre de presse, même entre guillemets, reste à
    vérifier sur l'article d'origine.
    """
    score, why = 0, []

    if _NOISE.search(text):
        return 0, ["rejeté : titre d'agenda / replay / sondage"]

    if is_tweet:
        score += 40
        why.append("verbatim garanti (mots propres de l'auteur)")
        score += 20
        why.append("URL directe vérifiable")
        if has_quote:
            why.append("citation explicite dans le tweet")
    elif has_quote:
        score += 40
        why.append("citation entre guillemets")

    if _ATTRIBUTION.search(text):
        score += 10
        why.append("verbe d'attribution")

    n = len(text)
    if 40 <= n <= 240:
        score += 15
        why.append("longueur exploitable")
    elif n < 25:
        score -= 20
        why.append("trop court")

    if text.rstrip().endswith("?") and not has_quote:
        score -= 15
        why.append("formulation interrogative")

    # Substance : un baromètre politique n'a que faire des messages de circonstance.
    theme = detect_theme(text)
    if theme:
        score += 15
        why.append(f"sujet identifié : {theme}")
    if is_ceremonial(text):
        score -= 35
        why.append("message de circonstance (vœux, hommage, sport)")
    elif not theme:
        score -= 15
        why.append("aucun sujet politique identifié")

    return max(0, min(100, score)), why


# --- candidates ----------------------------------------------------------
def candidates_from_tweet(row: dict) -> list[dict]:
    """Un tweet donne au plus une citation candidate — celle du titulaire."""
    body = clean_tweet(row.get("texte", ""))
    if not body:
        return []

    owner = row.get("nom", "")
    quoted = extract_quotes(body)

    if quoted:
        citation = quoted[0]
        if third_party_attribution(body, citation, owner):
            return []          # mots d'un tiers : ne jamais les attribuer au compte
        has_quote = True
    else:
        # Pas de paire de guillemets exploitable. Deux cas très différents :
        #
        #  - le tweet est de la prose directe -> c'est bien l'auteur qui parle ;
        #  - le tweet ouvre une citation que la troncature à 280 caractères
        #    laisse inachevée (« 🗣️ Fatia Alcabélard : « Claude… »). L'absence
        #    de fermeture ne doit surtout pas faire passer les mots d'un tiers
        #    pour ceux du titulaire du compte.
        citation = body
        has_quote = False
        if _words(citation) < MIN_TWEET_WORDS or not _SENTENCEISH.search(citation):
            return []
        if _has_dangling_quote(body) and third_party_attribution(body, "", owner):
            return []
        # Prose directe : un « Prénom Nom : » en tête annonce aussi un tiers.
        if _REPORTED_LEAD.match(body):
            return []

    if len(citation) < MIN_QUOTE_CHARS:
        return []

    score, why = score_candidate(citation, is_tweet=True, has_quote=has_quote)
    if score <= 0:
        return []
    return [{
        "nom": owner,
        "famille": row.get("famille"),
        "parti": row.get("parti"),
        "citation": citation,
        "date": row.get("date"),
        "source": row["source"],
        "tweet_id": row.get("id"),
        "origine": "x",
        "theme_suggere": detect_theme(citation),
        "protocolaire": is_ceremonial(citation),
        "score": score,
        "pourquoi": why,
        "verifie": True,          # mots propres de l'intéressé, URL directe
    }]


def candidates_from_rss(row: dict) -> list[dict]:
    """Un titre de presse ne donne une candidate que s'il cite explicitement."""
    title = row.get("titre", "")
    owner = row.get("nom", "")
    quoted = extract_quotes(title)
    if not quoted:
        return []

    citation = quoted[0]
    head = _name_tokens(owner)
    # Le titre doit nommer la personne suivie, sinon la citation est d'un tiers.
    if head and not (head & {normalise(w) for w in re.split(r"\W+", title)}):
        return []
    # Mais si son nom est DANS la citation, on parle d'elle, on ne la cite pas :
    # « Bruno Retailleau est celui qui manque à la France » n'est pas de lui.
    if head & {normalise(w) for w in re.split(r"\W+", citation)}:
        return []

    score, why = score_candidate(title, is_tweet=False, has_quote=True)
    if score <= 0:
        return []
    return [{
        "nom": owner,
        "famille": row.get("famille"),
        "parti": row.get("parti"),
        "citation": citation,
        "date": row.get("date"),
        "source": None,           # le lien Google News n'est pas une source citable
        "media": row.get("media"),
        "media_url": row.get("media_url"),
        "titre": title,
        "origine": "rss",
        "theme_suggere": detect_theme(title),
        "protocolaire": is_ceremonial(title),
        "score": score,
        "pourquoi": why,
        "verifie": False,         # exige une vérification sur l'article d'origine
    }]
