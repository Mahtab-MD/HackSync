-- Apply this migration to an existing HackSync database.
-- It does not insert seed data. Existing tasks without an owner remain hidden by RLS.
alter table public.tasks
  add column if not exists created_by uuid references public.users(id) on delete cascade;

alter table public.tasks
  alter column created_by set default auth.uid();

drop policy if exists "Authenticated users can view teammates" on public.users;
drop policy if exists "Users can update their profile" on public.users;
drop policy if exists "Users can view their own profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;

create policy "Users can view their own profile" on public.users
  for select to authenticated using (id = auth.uid());
create policy "Users can update their own profile" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Authenticated users can view tasks" on public.tasks;
drop policy if exists "Authenticated users can create tasks" on public.tasks;
drop policy if exists "Authenticated users can update tasks" on public.tasks;
drop policy if exists "Users can view owned or assigned tasks" on public.tasks;
drop policy if exists "Users can create their own tasks" on public.tasks;
drop policy if exists "Users can update assigned tasks" on public.tasks;

create policy "Users can view owned or assigned tasks" on public.tasks
  for select to authenticated using (created_by = auth.uid() or assignee_id = auth.uid());
create policy "Users can create their own tasks" on public.tasks
  for insert to authenticated with check (created_by = auth.uid() and assignee_id = auth.uid());
create policy "Users can update assigned tasks" on public.tasks
  for update to authenticated using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

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
