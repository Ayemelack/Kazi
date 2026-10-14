import 'dotenv/config';
import { createApp } from './app.js';
import { openDatabase, resolveDatabasePath } from './db/index.js';
import { log } from './log.js';
import { checkJwtSecret } from './secrets.js';

// Fail fast instead of serving 500s on the first authenticated request, and
// never run production with a guessable signing secret (KZ-29).
const secretCheck = checkJwtSecret(process.env.JWT_SECRET, process.env.NODE_ENV);
if (!secretCheck.ok) {
  log.error(secretCheck.error);
  process.exit(1);
}
if (secretCheck.warning) {
  log.warn(secretCheck.warning);
}

const port = Number(process.env.PORT ?? 4000);

log.info(`Kazi API database: ${resolveDatabasePath()}`);

const db = openDatabase();
const app = createApp(db);

const server = app.listen(port, () => {
  log.info(`Kazi API listening on http://localhost:${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  log.error(`Kazi API could not start on port ${port}: ${err.message}`);
  process.exit(1);
});
