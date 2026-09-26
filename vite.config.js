import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Solo in sviluppo: POST /__save?name=<file> con un data URL nel corpo scrive il file
// in public/nandor/. Serve a tools/nandor-photo.html per salvare la foto del modello.
function saveEndpoint() {
  return {
    name: 'nandor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
        if (req.method !== 'POST' || !/^[\w-]+\.(jpg|png)$/.test(name)) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const data = body.replace(/^data:image\/\w+;base64,/, '');
          const out = path.resolve('public/nandor', name);
          fs.writeFileSync(out, Buffer.from(data, 'base64'));
          res.end('saved ' + out);
        });
      });
    },
  };
}

// base relativa: la build funziona in qualsiasi sottocartella dell'hosting
export default defineConfig({ base: './', plugins: [saveEndpoint()] });
