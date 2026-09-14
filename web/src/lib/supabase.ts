import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Configuration Supabase manquante. Copiez .env.example vers .env.local " +
      "et renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY."
  );
}

/**
 * Client public. La clé publishable est faite pour être exposée : RLS
 * n'autorise que `select` sur `entries` (publiées) et `topics`. Aucune
 * écriture n'est possible depuis le navigateur.
 */
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
