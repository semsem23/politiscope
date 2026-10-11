-- Journal des numéros de la newsletter quotidienne.
--
-- Sert de garde-fou : relancer l'envoi le même jour (workflow rejoué, double
-- clic) ne doit jamais écrire deux fois aux abonnés. `newsletter` refuse un
-- jour déjà présent ici, sauf `--force`.
--
-- RLS actif et aucune policy : seule la connexion `postgres` du pipeline y
-- accède ; la clé publishable du navigateur n'y voit rien.

begin;

create table if not exists newsletter_issues (
  issue_date  date primary key,
  subject     text not null,
  n_entries   integer not null,
  status      text not null check (status in ('draft', 'sent')),
  provider_id text,
  created_at  timestamptz not null default now()
);

alter table newsletter_issues enable row level security;

commit;
