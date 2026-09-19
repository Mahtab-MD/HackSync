# HackSync

Real-time task coordination for hackathon teams, built with React, Vite, and Supabase.

## Run locally

```bash
npm install
npm run dev
```

The Windows workspace path contains `&`, so if npm scripts cannot resolve their `.bin` shims, run the local entrypoints directly:

```powershell
node .\node_modules\vite\bin\vite.js --host 0.0.0.0
```

## Supabase setup

1. Copy `.env.example` to `.env`.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Enable Google under Supabase Authentication providers and add `http://localhost:5173` to the redirect URLs.

Without Supabase credentials, the app runs in local preview mode with demo tasks.
