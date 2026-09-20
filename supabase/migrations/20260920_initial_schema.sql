create type public.user_role as enum ('lead', 'member');
create type public.task_status as enum ('todo', 'in_progress', 'done', 'blocked');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role public.user_role not null default 'member',
  avatar_initials text not null,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  created_by uuid not null references public.users(id) on delete cascade default auth.uid(),
  assignee_id uuid references public.users(id) on delete set null,
  status public.task_status not null default 'todo',
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.tasks enable row level security;

create policy "Users can view their own profile" on public.users
  for select to authenticated using (id = auth.uid());
create policy "Users can create their profile" on public.users
  for insert to authenticated with check (id = auth.uid());

create policy "Users can view owned or assigned tasks" on public.tasks
  for select to authenticated using (created_by = auth.uid() or assignee_id = auth.uid());
create policy "Users can create their own tasks" on public.tasks
  for insert to authenticated with check (created_by = auth.uid() and assignee_id = auth.uid());
create policy "Users can update assigned tasks" on public.tasks
  for update to authenticated using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

alter table public.tasks replica identity full;
alter publication supabase_realtime add table public.tasks;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, name, avatar_initials, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 2)),
    case when not exists (select 1 from public.users) then 'lead'::public.user_role else 'member'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.hacksync_healthcheck()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users_table', to_regclass('public.users') is not null,
    'tasks_table', to_regclass('public.tasks') is not null,
    'users_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.users')), false),
    'tasks_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tasks')), false),
    'task_policies', (select count(*) >= 3 from pg_policies where schemaname = 'public' and tablename = 'tasks')
  );
$$;

grant execute on function public.hacksync_healthcheck() to anon, authenticated;
