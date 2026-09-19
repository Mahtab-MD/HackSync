-- HackSync database schema. Run this in Supabase SQL Editor.
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
  assignee_id uuid references public.users(id) on delete set null,
  status public.task_status not null default 'todo',
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.tasks enable row level security;

create policy "Authenticated users can view teammates" on public.users
  for select to authenticated using (true);
create policy "Users can create their profile" on public.users
  for insert to authenticated with check (id = auth.uid());
create policy "Users can update their profile" on public.users
  for update to authenticated using (id = auth.uid());

create policy "Authenticated users can view tasks" on public.tasks
  for select to authenticated using (true);
create policy "Authenticated users can create tasks" on public.tasks
  for insert to authenticated with check (true);
create policy "Authenticated users can update tasks" on public.tasks
  for update to authenticated using (true);

alter table public.tasks replica identity full;
alter publication supabase_realtime add table public.tasks;

-- Create a profile after signup. The client also upserts this record for clarity.
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

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
