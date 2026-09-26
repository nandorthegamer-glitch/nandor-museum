// Cloudflare Pages Function: GET /api/downloads
// Legge i download di Races of Valheim da Thunderstore (che non permette la lettura
// diretta da un altro sito) e li gira al museo. Risposta in cache per un'ora.
const SRC = 'https://thunderstore.io/api/v1/package-metrics/Nandor/RacesOfValheim/';

export async function onRequestGet() {
  try {
    const r = await fetch(SRC, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return Response.json(
      { downloads: j.downloads, version: j.latest_version },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502 });
  }
}
