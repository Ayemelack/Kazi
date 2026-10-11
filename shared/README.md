# @kazi/shared

Contracts shared by the Kazi app (React Native, repository root) and the API (`server/`): constants,
validation limits, parsers and types that both sides must agree on. One source, imported by both.

Contents:

- `money.ts` — `parseMoneyInput` (whole-FCFA input parser), `formatMoney` (`1 000 FCFA`, narrow
  no-break spaces), `MONEY_MAX` (KZ-04, KZ-25).
- `limits.ts` — every length, quantity, password and paging limit both sides enforce, and
  `utf8ByteLength` for the 72-byte password limit (KZ-16).
- `date.ts` — the business-date window (2000-01-01 to today + 365 days) and date helpers (KZ-16).

Rules:

- Pure TypeScript. No runtime dependencies, no Node or React Native APIs (`tsconfig.json` has no
  `types` and no DOM lib, so the compiler rejects them).
- Relative imports use the `.js` extension (NodeNext ESM).
- Built with `tsc` to `dist/` (ES modules + `.d.ts`). `npm install` / `npm ci` here runs `prepare`,
  which builds it. The app and server depend on it with `file:` links, so **build `shared/` first**.

```bash
cd shared
npm ci          # installs dev tools and builds dist/
npm run check   # typecheck + tests + build
```

After editing `src/`, run `npm run build` (or `npm run check` at the repository root) so the app
and server see the change.
