// KZ-16: fields such as notes, descriptions and feedback are limited only by
// the TextInput's maxLength, so every maxLength in the app must name a shared
// constant from @kazi/shared rather than a number that could drift from the
// API's limit. Plain JS (not TS) because it reads the source tree with Node's
// fs, and the app's type program deliberately has no Node types.
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

describe('input lengths (KZ-16)', () => {
  it('no screen hard-codes a maxLength', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/maxLength=\{\s*\d/.test(line)) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('finds the inputs it is guarding', () => {
    const uses = sourceFiles(SRC)
      .map(file => fs.readFileSync(file, 'utf8'))
      .join('\n')
      .match(/maxLength=\{/g);
    expect((uses ?? []).length).toBeGreaterThanOrEqual(13);
  });
});
