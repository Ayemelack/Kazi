import 'dotenv/config';
import { createApp } from './app.js';
import { openDatabase, resolveDatabasePath } from './db.js';
import { log } from './log.js';

// Fail fast instead of serving 500s on the first authenticated request.
if (!process.env.JWT_SECRET) {
  log.error(
    'JWT_SECRET is missing. Set it in the environment or .env and start the server again.',
  );
  process.exit(1);
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