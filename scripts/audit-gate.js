// Dependency audit gate (KZ-19). Runs `npm audit --omit=dev` in each given
// directory and fails on any high or critical advisory, except those listed in
// scripts/audit-exceptions.json. An exception covers one advisory (GHSA id) of
// one package in one directory, must be explained in docs/SECURITY.md §6, and
// stops counting after its review date, so nothing is waived for ever.
//
// Usage: node scripts/audit-gate.js [dir ...]   (default: . server shared)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLOCKING = new Set(['high', 'critical']);

function loadExceptions() {
  const file = path.join(__dirname, 'audit-exceptions.json');
  const { exceptions } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const securityDoc = fs.readFileSync(path.join(ROOT, 'docs', 'SECURITY.md'), 'utf8');
  const problems = [];
  for (const e of exceptions) {
    if (!/^GHSA-[\w-]+$/.test(e.id) || !e.package || !e.dir || !/^\d{4}-\d{2}-\d{2}$/.test(e.reviewBy)) {
      problems.push(`audit-exceptions.json: malformed entry ${JSON.stringify(e)}`);
    } else if (!securityDoc.includes(e.id)) {
      problems.push(`${e.id} (${e.package}) is excepted but not documented in docs/SECURITY.md §6`);
    }
  }
  return { exceptions, problems };
}

function runAudit(dir) {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: path.join(ROOT, dir),
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    out = err.stdout;
  }
  const report = JSON.parse(out || '{}');
  if (report.error || !report.vulnerabilities) {
    throw new Error(`npm audit failed in ${dir}: ${JSON.stringify(report.error ?? report)}`);
  }
  return report;
}

/** Unique advisories in a report: { id, package, severity, title }. */
function advisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report.vulnerabilities)) {
    for (const via of vuln.via) {
      if (typeof via === 'object') {
        const id = via.url.split('/').pop();
        found.set(`${via.name}:${id}`, {
          id,
          package: via.name,
          severity: via.severity,
          title: via.title,
        });
      }
    }
  }
  return [...found.values()];
}

function main() {
  const dirs = process.argv.slice(2);
  const today = new Date().toISOString().slice(0, 10);
  const { exceptions, problems } = loadExceptions();
  const failures = [...problems];
  const used = new Set();

  for (const dir of dirs.length > 0 ? dirs : ['.', 'server', 'shared']) {
    const blocking = advisories(runAudit(dir)).filter(a => BLOCKING.has(a.severity));
    let excepted = 0;
    for (const a of blocking) {
      const e = exceptions.find(x => x.id === a.id && x.package === a.package && x.dir === dir);
      if (!e) {
        failures.push(`${dir}: ${a.severity} ${a.package} ${a.id} — ${a.title}`);
      } else if (e.reviewBy < today) {
        failures.push(`${dir}: exception for ${a.package} ${a.id} expired on ${e.reviewBy}; review it`);
      } else {
        used.add(e);
        excepted += 1;
        console.log(`${dir}: excepted until ${e.reviewBy}: ${a.severity} ${a.package} ${a.id}`);
      }
    }
    console.log(`${dir}: ${blocking.length} high/critical advisories, ${excepted} excepted`);
  }

  for (const e of exceptions) {
    if (!used.has(e) && (dirs.length === 0 || dirs.includes(e.dir))) {
      console.log(`note: exception ${e.id} (${e.package}) in ${e.dir} is no longer needed; remove it`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nAudit gate failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Audit gate passed.');
}

main();
