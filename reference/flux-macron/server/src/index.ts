import { createApp } from "./api";
import { CollectionService, startScheduler } from "./collect";
import { ALL_COLLECTORS } from "./collectors";
import { loadConfig } from "./config";
import { Store } from "./db";

const config = loadConfig();
const store = new Store(config.dbPath);
const service = new CollectionService(config, store, ALL_COLLECTORS);
const app = createApp({ config, store, collectors: ALL_COLLECTORS, service });

for (const w of config.warnings) console.warn(`[config] ${w}`);

app.listen(config.port, config.host, () => {
  console.log(`Flux Macron — http://${config.host}:${config.port}  (${config.demoMode ? "MODE DÉMONSTRATION" : "mode réel"})`);
  // Jamais de secret dans les journaux : seulement l'état « configurée ou non ».
  for (const c of ALL_COLLECTORS) {
    console.log(`  source ${c.label.padEnd(18)} ${config.demoMode ? "désactivée (démo)" : c.isConfigured(config) ? "configurée" : "non configurée"}`);
  }
  if (!config.adminToken) console.log("  administration (corrections manuelles) : désactivée (ADMIN_TOKEN non défini)");
  startScheduler(service, config);
});
