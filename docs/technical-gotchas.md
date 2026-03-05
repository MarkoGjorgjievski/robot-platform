# Technical Gotchas & Solutions

## CJS/ESM Interop in Vitest

**Problem**: vitest uses esbuild which treats files with `import`/`export` as ESM. The monorepo has a mix of CJS `.js` files using `require()` and new `.ts` files using ESM `import`.

**Solution stack**:
1. `vitest.setup.js` patches `Module._resolveFilename` — allows `require('./foo')` to find `foo.ts`
2. `.ts` sub-modules use ESM `import`/`export` with `.ts` extensions in import paths
3. `tsconfig.json` has `allowImportingTsExtensions: true` + `noEmit: true`
4. `helpersIndex.js` stays as `.js` (CJS facade) — uses `require()` to load `.ts` sub-modules

**What doesn't work**:
- Extensionless ESM imports between `.ts` files → vitest can't resolve
- `.js` extensions on imports when actual files are `.ts` → file not found
- `require()` inside `.ts` files → "require is not defined in ES module scope"
- `module.exports` in `.ts` files → works but loses type-checking (rejected)

## Circular Dependency: dom.ts ↔ misc.ts

**Problem**: `checkAndClick` (dom.ts) needs `ifThereClickOnIt` (misc.ts), but misc.ts imports `checkSelector` from dom.ts.

**Fix**: Lazy `await import('./misc.ts')` inside `checkAndClick` function body.

## TypeScript Check Noise

Running `tsc --noEmit` on @robot/core shows ~164 errors:
- Mostly TS7006/TS7031 (implicit `any`) in untyped config files
- Expected during incremental migration — not blocking
- Fixed 33 TS2580 errors by adding `@types/node`
- Fixed 16 TS5097 errors by adding `allowImportingTsExtensions`

## YAML Config Structure (robot-library)

```
src/orgs/{org}/domains/{letter}/{domain}/{country}/{robot}/{variant}/
  ├── extractor.yaml   (robot ref + parameters)
  ├── inputs.yaml      (keyed test data, _url + custom fields)
  └── credentials.yaml (default + branches)
```

- One exception: `sathiya` org uses `robots/domains/` instead of just `domains/`
- Parameters include XPaths, CSS selectors, timeouts, pagination config, ordered actions
- Template variables like `{id}`, `{userPool}` in URLTemplate get populated from inputs

## Next.js 15 Async Params

Dynamic route params are async in Next.js 15:
```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
```

## Drizzle ORM Schema Export

`@robot/db` exports both `db` instance and all schema tables from `@robot/db/schema`.
The `package.json` needs `"exports": { ".": "./src/index.ts", "./schema": "./src/schema.ts" }`.
