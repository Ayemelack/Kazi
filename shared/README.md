# @kazi/shared

Contracts shared by the Kazi app (React Native, repository root) and the API (`server/`): constants,
validation limits, parsers and types that both sides must agree on. One source, imported by both.

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
