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
  if (config.authMode === 'dev') {
    console.warn(
      'WARNING: MM_AUTH_MODE=dev — anyone who knows a roster email can sign in ' +
        'without a password. Use MM_AUTH_MODE=password for anything students touch.',
    );
  }
  const unregistered = db.listUsers().filter((u) => !u.registered).length;
  console.log(`roster: ${db.listUsers().length} accounts (${unregistered} not yet created)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
