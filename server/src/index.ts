// Entry point: load config, open the database, listen.
// Run with `npm run dev` (watch) or `npm start`; see server/README.md.

import { loadConfig } from './config';
import { Db } from './db';
import { createApp } from './app';

const config = loadConfig();
const db = new Db(config.dbPath);
const app = createApp(config, db);

const server = app.listen(config.port, () => {
  console.log(
    `making-minds API listening on :${config.port} ` +
      `(db=${config.dbPath}, auth=${config.authMode}, cors=[${config.corsOrigins.join(', ') || 'same-origin'}])`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
