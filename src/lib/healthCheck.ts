import { supabase } from './supabase'

// Development-only schema check. Vite removes this branch from production builds.
export async function runDevelopmentHealthCheck() {
  if (!import.meta.env.DEV || !supabase) return

  const { data, error } = await supabase.rpc('hacksync_healthcheck')
  if (error) {
    console.warn('[HackSync] Supabase health check failed. Run supabase/schema.sql in the SQL editor.', error)
    return
  }

  if (!data?.users_table || !data?.tasks_table || !data?.users_rls || !data?.tasks_rls || !data?.task_policies) {
    console.warn('[HackSync] Supabase schema is incomplete. Expected users/tasks tables, RLS, and task policies.', data)
    return
  }

  console.info('[HackSync] Supabase schema health check passed.')
}
