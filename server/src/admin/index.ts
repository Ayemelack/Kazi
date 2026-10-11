import https from 'node:https';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildApp, LoginThrottle, SessionStore, type AdminConfig } from './app.js';
import { loadCredentials } from './credentials.js';
import { ensureCertificate, lanAddresses, readTlsMaterial, type TlsMaterial } from './tls.js';
import { openDatabase } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TlsMode = 'auto' | 'on' | 'off';

interface Config extends AdminConfig {
  host: string;
  port: number;
  databasePath: string;
  credentialsPath: string;
  tlsMode: TlsMode;
  tlsDir: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  tlsOpensslPath?: string;
  tlsHosts: string[];
}

function parseTlsMode(value: string | undefined): TlsMode {
  if (value === '1' || value === 'on' || value === 'true') {
    return 'on';
  }
  if (value === '0' || value === 'off' || value === 'false') {
    return 'off';
  }
  return 'auto';
}

function loadConfig(): Config {
  const serverRoot = path.join(__dirname, '..', '..');
  const tlsDir = path.join(serverRoot, 'data', 'admin-tls');
  return {
    host: process.env.ADMIN_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.ADMIN_PORT ?? 4100),
    databasePath:
      process.env.DATABASE_PATH ?? path.join(serverRoot, 'data', 'kazi.db'),
    credentialsPath:
      process.env.ADMIN_CREDENTIALS_PATH ??
      path.join(serverRoot, 'data', 'admin-auth.json'),
    sessionTtlMs: Number(process.env.ADMIN_SESSION_TTL_MS ?? 12 * 60 * 60 * 1000),
    cookieSecure: process.env.ADMIN_COOKIE_SECURE === '1',
    tlsMode: parseTlsMode(process.env.ADMIN_TLS),
    tlsDir,
    tlsCertPath: process.env.ADMIN_TLS_CERT ?? path.join(tlsDir, 'cert.pem'),
    tlsKeyPath: process.env.ADMIN_TLS_KEY ?? path.join(tlsDir, 'key.pem'),
    tlsOpensslPath: process.env.ADMIN_TLS_OPENSSL,
    tlsHosts: (process.env.ADMIN_TLS_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0),
  };
}

function reachableUrls(scheme: string, host: string, port: number): string[] {
  if (host !== '0.0.0.0' && host !== '::') {
    return [`${scheme}://${host}:${port}`];
  }
  const addresses = lanAddresses();
  return addresses.length > 0
    ? addresses.map((address) => `${scheme}://${address}:${port}`)
    : [`${scheme}://localhost:${port}`];
}

function resolveTls(config: Config): TlsMaterial | undefined {
  if (config.tlsMode === 'off') {
    return undefined;
  }
  try {
    ensureCertificate({
      dir: config.tlsDir,
      certFile: config.tlsCertPath,
      keyFile: config.tlsKeyPath,
      hosts: ['localhost', '127.0.0.1', ...lanAddresses(), ...config.tlsHosts],
      opensslPath: config.tlsOpensslPath,
    });
    return readTlsMaterial(config.tlsCertPath, config.tlsKeyPath);
  } catch (err) {
    if (config.tlsMode === 'on') {
      throw err;
    }
    console.warn(
      '[admin] HTTPS unavailable, falling back to HTTP:',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

function main(): void {
  const config = loadConfig();

  const loaded = loadCredentials(config.credentialsPath);

  let db: Database.Database;
  try {
    db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
  } catch (err) {
    console.error(`[admin] could not open database read-only at ${config.databasePath}`);
    console.error(err);
    process.exit(1);
  }

  // Announcements are the one table admins write to. The read-only handle above
  // must stay read-only, so a separate writable connection is opened for that
  // single slot (the shared main database, so announcements travel through the
  // public API on the same stored file).
  let writeDb: Database.Database;
  try {
    writeDb = openDatabase({ filename: config.databasePath });
  } catch (err) {
    console.error(`[admin] could not open database for announcements at ${config.databasePath}`);
    console.error(err);
    db.close();
    process.exit(1);
  }

  const tls = resolveTls(config);
  config.cookieSecure = tls
    ? process.env.ADMIN_COOKIE_SECURE !== '0'
    : process.env.ADMIN_COOKIE_SECURE === '1';
  const scheme = tls ? 'https' : 'http';

  const sessions = new SessionStore(config.sessionTtlMs);
  const throttle = new LoginThrottle();
  const app = buildApp(db, writeDb, loaded.credentials, sessions, throttle, config);

  const onReady = (): void => {
    const urls = reachableUrls(scheme, config.host, config.port);
    console.log('============================================================');
    console.log(` Kazi Admin dashboard (${tls ? 'HTTPS' : 'HTTP'})`);
    for (const url of urls) {
      console.log(`   URL:      ${url}`);
    }
    console.log(`   Bind:     ${config.host}:${config.port}`);
    console.log(`   Username: ${loaded.credentials.username}`);
    if (loaded.generatedPassword) {
      console.log(`   Password: ${loaded.generatedPassword}`);
      console.log('   (generated on first run and shown once; a hash is stored in');
      console.log(`    ${config.credentialsPath})`);
    } else {
      console.log(`   Password: ${loaded.source === 'env' ? 'from ADMIN_PASSWORD' : 'from credentials file'}`);
    }
    console.log('   Read-only database:', config.databasePath);
    if (tls) {
      console.log(`   Certificate: ${config.tlsCertPath}`);
      console.log('   Self-signed: your browser will warn once; choose "Advanced"');
      console.log('   and proceed. The connection is still encrypted.');
    }
    console.log('   This dashboard is separate from the app. App user tokens are');
    console.log('   not accepted here and app users have no access.');
    console.log('============================================================');
  };

  const server: Server = tls
    ? https
        .createServer({ key: tls.key, cert: tls.cert }, app)
        .listen(config.port, config.host, onReady)
    : app.listen(config.port, config.host, onReady);

  const shutdown = (): void => {
    server.close(() => {
      db.close();
      writeDb.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();