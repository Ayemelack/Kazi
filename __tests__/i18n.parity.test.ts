import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';

type Tree = { [key: string]: string | Tree };

function leaves(node: unknown, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      Object.assign(result, leaves(value, path));
    }
    return result;
  }
  result[prefix] = String(node);
  return result;
}

const trees: [string, Record<string, string>][] = [
  ['en', leaves(en as Tree)],
  ['fr', leaves(fr as Tree)],
  ['wes', leaves(wes as Tree)],
];

describe('translation files', () => {
  it('covers exactly the same keys in every language', () => {
    const reference = Object.keys(trees[0][1]).sort();

    for (const [name, tree] of trees.slice(1)) {
      expect({ lang: name, keys: Object.keys(tree).sort() }).toEqual({
        lang: name,
        keys: reference,
      });
    }
  });

  it('has a non-empty string for every key in every language', () => {
    for (const [name, tree] of trees) {
      for (const [key, value] of Object.entries(tree)) {
        if (value.trim() === '') {
          throw new Error(`${name}: empty translation for "${key}"`);
        }
      }
    }
    expect(trees.every(([, tree]) => Object.keys(tree).length > 0)).toBe(true);
  });

  it('keeps the interpolation placeholders of the English source', () => {
    const english = trees[0][1];
    const placeholders = (value: string) => (value.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');

    for (const [name, tree] of trees.slice(1)) {
      for (const [key, value] of Object.entries(tree)) {
        expect({ lang: name, key, placeholders: placeholders(value) }).toEqual({
          lang: name,
          key,
          placeholders: placeholders(english[key]),
        });
      }
    }
  });
});
