import { supabase } from './supabase'

// Development-only schema check. Vite removes this branch from production builds.
export async function runDevelopmentHealthCheck() {
  if (!import.meta.env.DEV || !supabase) return

  const { data, error } = await supabase.rpc('hacksync_healthcheck')
  if (error) {
    console.warn('[HackSync] Supabase health check failed. Run supabase/migrations/20260920_multi_team_invites.sql in the SQL editor.', error)
    return
  }

  const required = ['users_table', 'tasks_table', 'teams_table', 'team_members_table', 'invites_table', 'users_rls', 'tasks_rls', 'teams_rls', 'team_members_rls', 'invites_rls'] as const
  const missing = required.filter((key) => !data?.[key])
  if (missing.length) {
    console.warn('[HackSync] Supabase schema is incomplete. Missing:', missing, data)
    return
  }

  console.info('[HackSync] Supabase schema health check passed.')
}
