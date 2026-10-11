// Source-level guards that keep fixed bugs from coming back. Plain JS (not TS)
// because it reads the source tree with Node's fs, and the app's type program
// deliberately has no Node types.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function matchingLines(dir, pattern) {
  const hits = [];
  for (const file of sourceFiles(dir)) {
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) {
          hits.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${i + 1}`);
        }
      });
  }
  return hits;
}

describe('source guards', () => {
  it('uses plain HTTP only for the development API host (KZ-01)', () => {
    const files = new Set(matchingLines(SRC, /http:\/\//).map(hit => hit.split(':')[0]));
    expect([...files]).toEqual(['config/env.ts']);
  });
});
