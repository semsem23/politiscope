import { useEffect } from "react";
import { FAMILLES } from "../types";

/**
 * Adresse de contact pour signaler une erreur. Laissée vide tant qu'aucune
 * adresse n'est choisie : la page n'affiche alors aucun contact plutôt qu'un
 * contact inventé.
 */
const CONTACT_EMAIL = "";

const TITLE = "Méthodologie et à propos — Politiscope";
const DESCRIPTION =
  "Comment Politiscope choisit, vérifie et classe les citations des responsables politiques français — et ce que le baromètre ne mesure pas.";

/** Page statique /methodologie : à propos, méthode, limites. */
export function MethodologyPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", DESCRIPTION);
    return () => {
      document.title = previous;
      if (meta && previousDescription !== null) meta.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">
          <a href="/" className="doc-back">
            ← Retour au baromètre
          </a>
        </p>
        <h1 className="title">Méthodologie</h1>
        <p className="dek">
          Politiscope rassemble ce que les responsables politiques français disent publiquement, à
          l'approche de la présidentielle de 2027. Cette page explique d'où viennent les citations,
          comment elles sont choisies, ce qui est automatique — et ce que le baromètre ne dit pas.
        </p>
      </header>

      <article className="doc-page">
        <section>
          <h2>À propos</h2>
          <p>
            Politiscope est un projet indépendant. Il ne s'agit ni d'un sondage, ni d'un classement,
            ni d'un jugement : le site met côte à côte des paroles publiques, sourcées, pour que
            chacun puisse comparer ce que les uns et les autres avancent sur les mêmes sujets.
          </p>
        </section>

        <section>
          <h2>D'où viennent les citations</h2>
          <p>
            Les citations proviennent des <strong>comptes officiels sur X</strong> d'un panel de 41
            responsables politiques, réparti en cinq familles (de 7 à 10 comptes
            chacune) :
          </p>
          <ul className="doc-families">
            {FAMILLES.map((f) => (
              <li key={f.id}>
                <span className="doc-dot" style={{ background: f.color }} aria-hidden="true" />
                {f.label}
              </li>
            ))}
          </ul>
          <p>
            Chaque citation renvoie vers le message d'origine : vous pouvez toujours le lire sur X,
            dans son contexte. Le texte affiché est celui du message, tel que publié — seuls les
            liens et les hashtags de fin sont retirés. Il n'est <strong>jamais réécrit,
            raccourci ni corrigé</strong>.
          </p>
        </section>

        <section>
          <h2>Comment elles sont choisies</h2>
          <p>
            Chaque nuit, le pipeline lit les nouveaux messages du panel, puis écarte ce qui n'est
            pas une prise de position de l'élu lui-même :
          </p>
          <ul>
            <li>les retweets et les réponses ;</li>
            <li>
              les propos d'un tiers cités par l'élu (« … », a dit untel) : on ne les lui attribue
              jamais ;
            </li>
            <li>les vœux, hommages, remerciements et résultats sportifs ;</li>
            <li>
              l'<strong>autopromotion</strong> : « retrouvez mon interview », « invité de TF1 »,
              « rendez-vous à 20 h » annoncent une prise de parole sans en être une ;
            </li>
            <li>les messages qui ne relèvent d'aucun des sujets suivis.</li>
          </ul>
          <p>
            Parmi ce qui reste, la sélection quotidienne retient au plus{" "}
            <strong>une citation par personne</strong> et répartit les places{" "}
            <strong>à tour de rôle entre les cinq familles</strong>, en commençant par les moins
            représentées sur le site. Sans cela, les comptes qui publient le plus occuperaient tout
            l'espace.
          </p>
        </section>

        <section>
          <h2>Ce qui est automatique</h2>
          <p>
            La collecte, la sélection et la publication se font <strong>sans relecture
            individuelle</strong>. Concrètement :
          </p>
          <ul>
            <li>
              le <strong>thème</strong> de chaque citation est attribué par détection automatique
              de mots-clés ; il peut se tromper, ou rester approximatif pour un message qui aborde
              plusieurs sujets ;
            </li>
            <li>
              les filtres ci-dessus sont des règles, pas un jugement humain : une prise de position
              peut être écartée à tort, et une annonce peut passer au travers.
            </li>
          </ul>
          <p>
            La règle de prudence est de préférer écarter une bonne citation plutôt que d'en
            attribuer une mauvaise.
          </p>
        </section>

        <section>
          <h2>Flux live</h2>
          <p>
            Le flux live liste les titres de la rubrique « France » de Google Actualités qui
            mentionnent l'un des sept sujets suivis. Seul le titre est affiché, avec le nom de
            l'éditeur et un lien vers l'article. Le classement par sujet repose sur des mots-clés
            dans le titre.
          </p>
        </section>

        <section>
          <h2>Ce que le baromètre ne mesure pas</h2>
          <ul>
            <li>
              <strong>Ce n'est pas une mesure d'opinion.</strong> Le nombre de citations d'une
              personne dépend de sa fréquence de publication sur X, pas de son poids politique.
            </li>
            <li>
              <strong>L'historique n'est pas équilibré.</strong> L'équilibre entre familles est
              appliqué à la sélection depuis octobre 2026 ; les citations plus anciennes reflètent
              davantage les comptes les plus actifs.
            </li>
            <li>
              <strong>Un tweet n'est pas tout ce qu'un élu dit.</strong> Discours, interviews et
              votes ne sont pas couverts.
            </li>
            <li>
              <strong>Une citation n'est pas un engagement</strong> ni la position complète de son
              auteur sur le sujet.
            </li>
          </ul>
        </section>

        {CONTACT_EMAIL && (
          <section>
            <h2>Signaler une erreur</h2>
            <p>
              Une mauvaise attribution, une citation tronquée, un thème manifestement faux ?
              Écrivez à <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> en indiquant
              l'adresse de la citation.
            </p>
          </section>
        )}
      </article>
    </div>
  );
}
