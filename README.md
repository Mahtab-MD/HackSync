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
3. Run `supabase/schema.sql` in the Supabase SQL editor. For an existing installation, run `supabase/migrations/20260920_scope_tasks_to_authenticated_users.sql` instead.
4. Add `http://localhost:5173` to the Supabase authentication URL configuration.

Without Supabase credentials, the app shows a connection-required state and never renders local task or teammate data.
