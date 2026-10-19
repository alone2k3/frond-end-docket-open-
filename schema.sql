-- Front End Docket: database setup for Supabase.
-- Run this once in Supabase: SQL Editor, New query, paste, Run.
-- Do it BEFORE the first person creates an account, so the first account becomes the editor.

-- ---------------------------------------------------------------- people and roles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'pending' check (role in ('pending', 'viewer', 'editor')),
  created_at timestamptz not null default now()
);

-- Every new account gets a profile. The very first account becomes an editor.
-- Everyone after starts as 'pending' and cannot see any data until an editor approves them.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, case when (select count(*) from public.profiles) = 0 then 'editor' else 'pending' end);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_editor()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'editor');
$$;

create or replace function public.is_member()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('editor', 'viewer'));
$$;

-- ---------------------------------------------------------------- docket data
-- One sheet per shooting day.
create table if not exists public.shoots (
  id uuid primary key,
  shoot_date date not null unique,
  show text not null default '',
  location text not null default '',
  sched_from text not null default '',
  sched_to text not null default '',
  act_from text not null default '',
  act_to text not null default '',
  sig_prod text not null default '',
  sig_sage text not null default '',
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per person on a day's attendance sheet.
create table if not exists public.attendance (
  id uuid primary key,
  shoot_id uuid not null references public.shoots (id) on delete cascade,
  name text not null default '',
  desig text not null default '',
  card text not null default '',
  time_in text not null default '',
  time_out text not null default '',
  sign_in text not null default '',
  sign_out text not null default '',
  amount numeric,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists attendance_shoot_idx on public.attendance (shoot_id, created_at);

-- Saved crew list, so repeat crew fill in their department and card number.
create table if not exists public.crew (
  id uuid primary key,
  name text not null unique,
  desig text not null default '',
  card text not null default ''
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists shoots_touch on public.shoots;
create trigger shoots_touch before update on public.shoots for each row execute function public.touch_updated_at();
drop trigger if exists attendance_touch on public.attendance;
create trigger attendance_touch before update on public.attendance for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- who can do what
alter table public.profiles enable row level security;
alter table public.shoots enable row level security;
alter table public.attendance enable row level security;
alter table public.crew enable row level security;

-- Approved accounts (viewer or editor) can read. Only editors can add, change or delete.
-- Accounts still marked 'pending' can read nothing but their own profile.
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to authenticated using (id = auth.uid() or public.is_editor());
drop policy if exists "editors change roles" on public.profiles;
create policy "editors change roles" on public.profiles for update to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read shoots" on public.shoots;
create policy "read shoots" on public.shoots for select to authenticated using (public.is_member());
drop policy if exists "write shoots" on public.shoots;
create policy "write shoots" on public.shoots for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read attendance" on public.attendance;
create policy "read attendance" on public.attendance for select to authenticated using (public.is_member());
drop policy if exists "write attendance" on public.attendance;
create policy "write attendance" on public.attendance for all to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists "read crew" on public.crew;
create policy "read crew" on public.crew for select to authenticated using (public.is_member());
drop policy if exists "write crew" on public.crew;
create policy "write crew" on public.crew for all to authenticated using (public.is_editor()) with check (public.is_editor());

-- ---------------------------------------------------------------- live updates
alter publication supabase_realtime add table public.shoots;
alter publication supabase_realtime add table public.attendance;
alter publication supabase_realtime add table public.crew;

-- ---------------------------------------------------------------- more reports (v2)
-- Vehicle, Camera, Picture Vehicle and Vanity Van / Generator reports all live in one table.
-- report: veh | cam | pic | van   grp: '' for the main table, 'gen' for the generator table.
-- data holds that row's fields (times, names, signatures...) as JSON.
alter table public.shoots add column if not exists sigs jsonb not null default '{}'::jsonb;

create table if not exists public.report_rows (
  id uuid primary key,
  shoot_id uuid not null references public.shoots (id) on delete cascade,
  report text not null check (report in ('veh', 'cam', 'pic', 'van')),
  grp text not null default '',
  data jsonb not null default '{}'::jsonb,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_rows_shoot_idx on public.report_rows (shoot_id, report, created_at);
drop trigger if exists report_rows_touch on public.report_rows;
create trigger report_rows_touch before update on public.report_rows for each row execute function public.touch_updated_at();

alter table public.report_rows enable row level security;
drop policy if exists "read report_rows" on public.report_rows;
create policy "read report_rows" on public.report_rows for select to authenticated using (public.is_member());
drop policy if exists "write report_rows" on public.report_rows;
create policy "write report_rows" on public.report_rows for all to authenticated using (public.is_editor()) with check (public.is_editor());

alter publication supabase_realtime add table public.report_rows;
