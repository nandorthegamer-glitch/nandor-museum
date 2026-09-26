// Aggiorna il numero di download di Races of Valheim per il tabellone della stanza.
// Thunderstore non permette di leggere le sue API da un altro sito (niente CORS), quindi
// il numero si legge qui, prima di ogni build (npm run build lo lancia da solo), e il
// museo pubblicato mostra quello dell'ultima pubblicazione. Se la rete manca, resta il
// valore precedente.
//
// Uso: node tools/update-downloads.mjs

import fs from 'node:fs';

const URL = 'https://thunderstore.io/api/v1/package-metrics/Nandor/RacesOfValheim/';
const OUT = 'rooms/races-of-valheim/media/downloads.json';

try {
  const r = await fetch(URL);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  fs.mkdirSync('rooms/races-of-valheim/media', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ downloads: j.downloads, version: j.latest_version, fetched: new Date().toISOString() }, null, 1));
  console.log(`download Races of Valheim: ${j.downloads} (versione ${j.latest_version})`);
} catch (e) {
  console.warn('download non aggiornati (' + e.message + '): resta il valore precedente');
}
