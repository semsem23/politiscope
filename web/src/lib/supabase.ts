import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Client public, ou `null` si la configuration manque. La clé publishable
 * est faite pour être exposée : RLS n'autorise que `select` sur `entries`
 * (publiées), `topics` et `site_context`. Aucune écriture n'est possible
 * depuis le navigateur.
 *
 * Ne jette plus à l'import : une configuration manquante levait une
 * exception au chargement du module, avant même que React ne monte quoi
 * que ce soit — un écran blanc, sans message. `usePolitiscopeData` (voir
 * usePolitiscope.ts) vérifie `supabase` et bascule directement sur l'état
 * d'erreur habituel de l'appli à la place.
 */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

/** Message à afficher quand `supabase` est `null`. */
export const supabaseConfigError: string | null = supabase
  ? null
  : "Configuration Supabase manquante (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).";
