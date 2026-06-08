# tools/ — server-side only

Scripts in this directory run on a trusted machine (CLI / backend), **never in the browser**.

`processSession.ts` uses `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses all Row Level
Security**. Treat it like a root password.

## Hard rules

- **Do not** import anything from `tools/` into `src/`. The Vite build only compiles
  `src/` (see `tsconfig.json` `"include": ["src"]`), so code here is never bundled into
  the client — keep it that way.
- The service-role key lives in `tools/.env` (gitignored). Never put it behind a `VITE_`
  name and never commit it.

## Run

```bash
# tools/.env must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npx tsx tools/processSession.ts <path/to/session.ndjson>
```

## Recommended next step

For stronger isolation, relocate this tooling to a separate backend repo or a Supabase
Edge Function so the service-role key never sits in the same tree as client code. If the
key was ever committed to git history, **rotate it** in the Supabase dashboard.
