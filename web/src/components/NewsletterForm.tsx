/**
 * Inscription à la newsletter quotidienne (Buttondown).
 *
 * Le formulaire poste directement chez Buttondown, qui gère le double opt-in,
 * la désinscription et le consentement : aucune adresse ne transite par ce
 * site. Rien ne s'affiche tant que VITE_BUTTONDOWN_USERNAME n'est pas défini,
 * pour ne jamais montrer un formulaire qui ne mène nulle part.
 */
const USERNAME = (import.meta.env.VITE_BUTTONDOWN_USERNAME as string | undefined)?.trim();

export function NewsletterForm() {
  if (!USERNAME) return null;
  return (
    <form
      className="newsletter"
      action={`https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(USERNAME)}`}
      method="post"
      target="popupwindow"
      onSubmit={() => {
        window.open(`https://buttondown.com/${encodeURIComponent(USERNAME)}`, "popupwindow");
      }}
    >
      <label htmlFor="newsletter-email">
        <strong>Une fois par jour</strong>, les citations de la veille dans votre boîte mail.
      </label>
      <div className="newsletter-row">
        <input id="newsletter-email" type="email" name="email" placeholder="votre@email.fr" required />
        <input type="hidden" value="1" name="embed" />
        <button type="submit" className="toggle-btn">
          Je m'abonne
        </button>
      </div>
      <p className="newsletter-note">
        Un e-mail de confirmation vous sera envoyé. Désinscription en un clic.{" "}
        <a href="/methodologie">Comment les citations sont choisies</a>.
      </p>
    </form>
  );
}
