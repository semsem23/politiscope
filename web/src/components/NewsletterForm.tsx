/**
 * Inscription à la newsletter quotidienne (Brevo).
 *
 * Le formulaire est celui que Brevo héberge (Contacts > Formulaires > Partager
 * > lien) : il gère lui-même le consentement, l'e-mail de confirmation
 * (double opt-in) et la désinscription, et aucune adresse ne transite par ce
 * site. Rien ne s'affiche tant que VITE_BREVO_FORM_URL n'est pas défini, pour
 * ne jamais montrer un formulaire qui ne mène nulle part.
 */
const FORM_URL = (import.meta.env.VITE_BREVO_FORM_URL as string | undefined)?.trim();

// N'accepte que les formulaires hébergés par Brevo : une variable mal remplie
// ne doit pas pouvoir faire intégrer un autre site.
const isBrevoForm = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".sibforms.com");
  } catch {
    return false;
  }
};

export function NewsletterForm() {
  if (!FORM_URL || !isBrevoForm(FORM_URL)) return null;
  return (
    <section className="newsletter" aria-label="Newsletter">
      <p className="newsletter-lead">
        <strong>Une fois par jour</strong>, les citations de la veille dans votre boîte mail.
      </p>
      <iframe className="newsletter-frame" src={FORM_URL} title="Inscription à la newsletter" loading="lazy" />
      <p className="newsletter-note">
        Un e-mail de confirmation vous sera envoyé. Désinscription en un clic.{" "}
        <a href="/methodologie">Comment les citations sont choisies</a>.
      </p>
    </section>
  );
}
