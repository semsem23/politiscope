import { Analytics } from "@vercel/analytics/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// Polices auto-hébergées (@fontsource) : plus de requête vers Google Fonts.
// Seuls les graisses réellement utilisées (voir index.css) sont importées.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
// Fraunces est utilisé à des graisses non standard (620, 680) réglées au
// pixel près pour le titre : seule la variante variable les rend fidèlement.
// "standard" = axes opsz+wght (comme la requête Google Fonts d'origine),
// sans SOFT/WONK, non utilisés ici.
import "@fontsource-variable/fraunces/standard.css";
import "@fontsource-variable/fraunces/standard-italic.css";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>
);
