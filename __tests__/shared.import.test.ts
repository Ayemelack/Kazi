import { CURRENCY_CODE } from '@kazi/shared';

// Proves the app toolchain (Jest + Babel) resolves the @kazi/shared file:
// link and loads its compiled ES module build.
describe('@kazi/shared', () => {
  it('is importable from the app', () => {
    expect(CURRENCY_CODE).toBe('XAF');
  });
});
