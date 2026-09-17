import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// TLS for the admin dashboard. A self-signed certificate is generated on first
// use (via the OpenSSL binary bundled with Git for Windows) unless certificate
// files are supplied through the environment. Everything lives under the
// git-ignored server/data directory.

const VIRTUAL_ADAPTER =
  /vmware|virtualbox|hyper-v|vethernet|loopback|bluetooth|docker|wsl|tailscale|zerotier|radmin|hamachi/i;

export function lanAddresses(): string[] {
  const physical: string[] = [];
  const other: string[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }
      if (VIRTUAL_ADAPTER.test(name)) {
        other.push(info.address);
      } else {
        physical.push(info.address);
      }
    }
  }
  return physical.length > 0 ? physical : other;
}

function findOpenssl(explicit: string | undefined): string | undefined {
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : undefined;
  }
  const candidates = [
    'C:/Program Files/Git/usr/bin/openssl.exe',
    'C:/Program Files/Git/mingw64/bin/openssl.exe',
    'C:/Program Files (x86)/Git/usr/bin/openssl.exe',
    '/usr/bin/openssl',
    '/usr/local/bin/openssl',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const output = execFileSync('where', ['openssl'], { encoding: 'utf8' });
    const first = output.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) {
      return first;
    }
  } catch {
    // openssl is not on PATH.
  }
  return undefined;
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function buildConfig(hosts: string[]): string {
  const unique = Array.from(new Set(hosts.filter((host) => host.trim().length > 0)));
  const altNames: string[] = [];
  unique.forEach((host, index) => {
    const kind = isIpv4(host) ? 'IP' : 'DNS';
    altNames.push(`${kind}.${index + 1} = ${host}`);
  });

  return [
    '[req]',
    'distinguished_name = req_dn',
    'x509_extensions = v3_req',
    'prompt = no',
    '',
    '[req_dn]',
    'CN = Kazi Admin',
    'O = Kazi',
    '',
    '[v3_req]',
    'basicConstraints = CA:FALSE',
    'keyUsage = digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
    ...altNames,
    '',
  ].join('\n');
}

export interface CertificateOptions {
  dir: string;
  certFile: string;
  keyFile: string;
  hosts: string[];
  opensslPath?: string;
}

export function ensureCertificate(options: CertificateOptions): void {
  if (fs.existsSync(options.certFile) && fs.existsSync(options.keyFile)) {
    return;
  }

  const openssl = findOpenssl(options.opensslPath);
  if (!openssl) {
    throw new Error(
      'OpenSSL was not found. Install Git for Windows (which bundles it) or set ADMIN_TLS_OPENSSL to the openssl executable.',
    );
  }

  fs.mkdirSync(options.dir, { recursive: true });
  fs.writeFileSync(path.join(options.dir, 'openssl.cnf'), buildConfig(options.hosts), {
    mode: 0o600,
  });

  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'key.pem',
      '-out',
      'cert.pem',
      '-days',
      '825',
      '-subj',
      '/CN=Kazi Admin/O=Kazi',
      '-config',
      'openssl.cnf',
      '-extensions',
      'v3_req',
    ],
    { cwd: options.dir, stdio: 'pipe' },
  );

  if (!fs.existsSync(options.certFile) || !fs.existsSync(options.keyFile)) {
    throw new Error('Certificate generation did not produce the expected files.');
  }
}

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
}

export function readTlsMaterial(certFile: string, keyFile: string): TlsMaterial {
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}
