-- Contenu de l'en-tête éditable sans déploiement.
--
-- L'eyebrow ("Baromètre politique · Rentrée 2026") et le paragraphe de
-- contexte du masthead étaient codés en dur dans App.tsx : changer la
-- saison ou reformuler le contexte politique demandait un déploiement.
-- Une table clé/valeur minimale suffit -- ce n'est pas du contenu
-- éditorialisé comme `entries`, juste deux chaînes de texte affichage.
--
-- Le front-end lit cette table et se rabat sur les chaînes actuelles codées
-- en dur si la table n'existe pas encore (migration pas appliquée) ou si
-- une clé précise manque -- voir useSiteContext dans usePolitiscope.ts,
-- même principe de repli que la vue `personnalites` (006).

begin;

create table if not exists site_context (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

comment on table site_context is
  'Texte du masthead (eyebrow, paragraphe de contexte), modifiable sans '
  'déploiement. Pas du contenu éditorialisé -- voir entries pour ça.';

drop trigger if exists site_context_touch on site_context;
create trigger site_context_touch before update on site_context
  for each row execute function touch_updated_at();

insert into site_context (key, value) values
  ('eyebrow', 'Baromètre politique · Rentrée 2026'),
  ('contexte',
   'Les élections municipales se sont achevées en mars 2026 ; la France entre désormais en ' ||
   'pré-campagne pour la présidentielle de 2027. Le gouvernement de Sébastien Lecornu, formé ' ||
   'fin février après avoir fait passer le budget 2026 au 49.3, affronte une contestation ' ||
   'sociale naissante sur le pouvoir d''achat pendant que plusieurs figures officialisent leur ' ||
   'candidature à l''occasion des universités d''été de septembre.')
on conflict (key) do nothing;

alter table site_context enable row level security;

drop policy if exists lecture_publique_site_context on site_context;
create policy lecture_publique_site_context on site_context
  for select to anon, authenticated using (true);

commit;
