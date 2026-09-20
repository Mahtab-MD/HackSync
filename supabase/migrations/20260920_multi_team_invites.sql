-- HackSync multi-team membership and invite model.
-- Apply after the existing single-team schema migrations.

do $$ begin
  create type public.team_role as enum ('lead', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete cascade;

-- Preserve existing data by creating one private legacy team per existing user.
do $$
declare
  current_user_row record;
  legacy_team_id uuid;
begin
  for current_user_row in select id, name, role from public.users loop
    if not exists (select 1 from public.team_members where user_id = current_user_row.id) then
      insert into public.teams (name, created_by)
      values (coalesce(nullif(current_user_row.name, ''), 'Legacy Workspace'), current_user_row.id)
      returning id into legacy_team_id;
      insert into public.team_members (team_id, user_id, role)
      values (legacy_team_id, current_user_row.id, case when current_user_row.role::text = 'lead' then 'lead'::public.team_role else 'member'::public.team_role end);
      update public.tasks set team_id = legacy_team_id where created_by = current_user_row.id and team_id is null;
    end if;
  end loop;
end $$;

alter table public.users drop column if exists role;
alter table public.users drop column if exists created_at;

create index if not exists invites_code_idx on public.invites(code);
create index if not exists tasks_team_id_idx on public.tasks(team_id);
create index if not exists team_members_user_id_idx on public.team_members(user_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.invites enable row level security;
alter table public.tasks enable row level security;

create or replace function public.is_team_member(target_team_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = target_team_id and user_id = target_user_id);
$$;

create or replace function public.is_team_lead(target_team_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = target_team_id and user_id = target_user_id and role = 'lead');
$$;

grant execute on function public.is_team_member(uuid, uuid) to authenticated;
grant execute on function public.is_team_lead(uuid, uuid) to authenticated;

alter table public.tasks replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_rel
    where prpubid = (select oid from pg_publication where pubname = 'supabase_realtime')
      and prrelid = 'public.tasks'::regclass
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

drop policy if exists "Users can view their own profile" on public.users;
drop policy if exists "Users can create their profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;
drop policy if exists "Users can view owned or assigned tasks" on public.tasks;
drop policy if exists "Users can create their own tasks" on public.tasks;
drop policy if exists "Users can update assigned tasks" on public.tasks;
drop policy if exists "Users can view teams" on public.teams;
drop policy if exists "Users can create teams" on public.teams;
drop policy if exists "Users can view team members" on public.team_members;
drop policy if exists "Users can view team invites" on public.invites;
drop policy if exists "Leads can create team invites" on public.invites;

create policy "Users can view their own profile" on public.users
  for select to authenticated using (id = auth.uid());
create policy "Users can create their profile" on public.users
  for insert to authenticated with check (id = auth.uid());
create policy "Users can update their own profile" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Users can view teams" on public.teams
  for select to authenticated using (public.is_team_member(id));
create policy "Users can create teams" on public.teams
  for insert to authenticated with check (created_by = auth.uid());

create policy "Users can view team members" on public.team_members
  for select to authenticated using (public.is_team_member(team_id));

create policy "Users can view team invites" on public.invites
  for select to authenticated using (public.is_team_member(team_id));
create policy "Leads can create team invites" on public.invites
  for insert to authenticated with check (
    public.is_team_member(team_id)
    and created_by = auth.uid()
    and public.is_team_lead(team_id)
  );

create policy "Members can view team tasks" on public.tasks
  for select to authenticated using (public.is_team_member(team_id));
create policy "Leads can create team tasks" on public.tasks
  for insert to authenticated with check (
    public.is_team_member(team_id)
    and public.is_team_lead(team_id)
    and public.is_team_member(team_id, assignee_id)
  );
create policy "Team members can update assigned tasks" on public.tasks
  for update to authenticated using (
    public.is_team_member(team_id)
    and (assignee_id = auth.uid() or public.is_team_lead(team_id))
  ) with check (
    public.is_team_member(team_id)
    and public.is_team_member(team_id, assignee_id)
  );

create or replace function public.prevent_member_task_reassignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_lead(old.team_id) and (new.team_id <> old.team_id or new.assignee_id is distinct from old.assignee_id or new.created_by <> old.created_by) then
    raise exception 'Only a team lead can reassign tasks';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_member_task_reassignment on public.tasks;
create trigger prevent_member_task_reassignment
before update on public.tasks
for each row execute procedure public.prevent_member_task_reassignment();

create or replace function public.create_team(team_name text)
returns public.teams
language plpgsql security definer set search_path = public as $$
declare new_team public.teams;
begin
  if auth.uid() is null or nullif(trim(team_name), '') is null then raise exception 'Invalid team name'; end if;
  insert into public.teams (name, created_by) values (trim(team_name), auth.uid()) returning * into new_team;
  insert into public.team_members (team_id, user_id, role) values (new_team.id, auth.uid(), 'lead');
  return new_team;
end;
$$;

grant execute on function public.create_team(text) to authenticated;

create or replace function public.validate_invite(invite_code text)
returns table (team_id uuid, team_name text, expires_at timestamptz)
language sql security definer set search_path = public as $$
  select i.team_id, t.name, i.expires_at
  from public.invites i join public.teams t on t.id = i.team_id
  where upper(i.code) = upper(trim(invite_code)) and i.expires_at > now();
$$;

grant execute on function public.validate_invite(text) to anon, authenticated;

create or replace function public.create_team_invite(target_team_id uuid)
returns public.invites
language plpgsql security definer set search_path = public as $$
declare new_invite public.invites;
  generated_code text;
begin
  if not exists (select 1 from public.team_members where team_id = target_team_id and user_id = auth.uid() and role = 'lead') then
    raise exception 'Only a team lead can create invites';
  end if;
  generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invites (team_id, code, created_by) values (target_team_id, generated_code, auth.uid()) returning * into new_invite;
  return new_invite;
end;
$$;

grant execute on function public.create_team_invite(uuid) to authenticated;

create or replace function public.accept_team_invite(target_team_id uuid)
returns public.team_members
language plpgsql security definer set search_path = public as $$
declare membership public.team_members;
begin
  if auth.uid() is null or not exists (select 1 from public.teams where id = target_team_id) then raise exception 'Invalid team'; end if;
  if not exists (select 1 from public.invites where team_id = target_team_id and expires_at > now()) then raise exception 'No valid invite exists for this team'; end if;
  if exists (select 1 from public.team_members where team_id = target_team_id and user_id = auth.uid()) then raise exception 'You are already a member of this team'; end if;
  insert into public.team_members (team_id, user_id, role) values (target_team_id, auth.uid(), 'member') returning * into membership;
  return membership;
end;
$$;

grant execute on function public.accept_team_invite(uuid) to authenticated;

-- Update the signup trigger to stop referencing the dropped role column.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, name, avatar_initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 2))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Updated health check covering the multi-team schema.
create or replace function public.hacksync_healthcheck()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users_table', to_regclass('public.users') is not null,
    'tasks_table', to_regclass('public.tasks') is not null,
    'teams_table', to_regclass('public.teams') is not null,
    'team_members_table', to_regclass('public.team_members') is not null,
    'invites_table', to_regclass('public.invites') is not null,
    'users_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.users')), false),
    'tasks_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tasks')), false),
    'teams_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.teams')), false),
    'team_members_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.team_members')), false),
    'invites_rls', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.invites')), false)
  );
$$;

grant execute on function public.hacksync_healthcheck() to anon, authenticated;
