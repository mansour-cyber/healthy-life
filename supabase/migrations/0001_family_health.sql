begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin','member');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.goal_frequency as enum ('daily','weekly');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.med_log_status as enum ('taken','skipped');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'member',
  manager_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  category text not null default 'عام',
  frequency public.goal_frequency not null default 'daily',
  target_value numeric,
  unit text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_logs (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null default current_date,
  completed boolean not null default false,
  value numeric,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(goal_id, log_date)
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  instructions text,
  start_date date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  time_of_day time not null,
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  reminder_minutes_before integer not null default 5 check (reminder_minutes_before between 0 and 1440),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(medication_id, time_of_day),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.medication_schedules(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null default current_date,
  status public.med_log_status not null default 'taken',
  taken_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(schedule_id, log_date)
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  reminder_type text not null default 'general',
  time_of_day time not null,
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  note text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[])
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin' and is_active = true
  );
$$;

create or replace function public.can_manage_user(target_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_uid = auth.uid()
  or exists (
    select 1
    from public.profiles a
    join public.profiles m on m.id = target_uid
    where a.id = auth.uid()
      and a.role = 'admin'
      and a.is_active = true
      and m.manager_id = auth.uid()
      and m.is_active = true
  );
$$;

create or replace function public.admin_initialized()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where role = 'admin');
$$;

create or replace function public.claim_first_admin(p_full_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform pg_advisory_xact_lock(908172635);

  if exists(select 1 from public.profiles where role = 'admin') then
    raise exception 'admin already initialized';
  end if;

  update public.profiles
  set role = 'admin',
      manager_id = null,
      full_name = coalesce(nullif(trim(p_full_name),''), full_name),
      updated_at = now()
  where id = auth.uid()
  returning * into result;

  if result.id is null then
    raise exception 'profile not found';
  end if;

  return result;
end;
$$;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id and not public.is_admin(auth.uid()) then
    new.role := old.role;
    new.manager_id := old.manager_id;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

create or replace function public.sync_goal_log_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select owner_id into new.owner_id from public.goals where id = new.goal_id;
  if new.owner_id is null then raise exception 'goal not found'; end if;
  return new;
end;
$$;

create or replace function public.sync_schedule_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select owner_id into new.owner_id from public.medications where id = new.medication_id;
  if new.owner_id is null then raise exception 'medication not found'; end if;
  return new;
end;
$$;

create or replace function public.sync_med_log_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select owner_id into new.owner_id from public.medication_schedules where id = new.schedule_id;
  if new.owner_id is null then raise exception 'schedule not found'; end if;
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields before update on public.profiles for each row execute function public.protect_profile_fields();

drop trigger if exists goals_updated_at on public.goals;
create trigger goals_updated_at before update on public.goals for each row execute function public.set_updated_at();
drop trigger if exists goal_logs_updated_at on public.goal_logs;
create trigger goal_logs_updated_at before update on public.goal_logs for each row execute function public.set_updated_at();
drop trigger if exists goal_logs_owner on public.goal_logs;
create trigger goal_logs_owner before insert or update on public.goal_logs for each row execute function public.sync_goal_log_owner();

drop trigger if exists medications_updated_at on public.medications;
create trigger medications_updated_at before update on public.medications for each row execute function public.set_updated_at();
drop trigger if exists schedules_updated_at on public.medication_schedules;
create trigger schedules_updated_at before update on public.medication_schedules for each row execute function public.set_updated_at();
drop trigger if exists schedules_owner on public.medication_schedules;
create trigger schedules_owner before insert or update on public.medication_schedules for each row execute function public.sync_schedule_owner();
drop trigger if exists medication_logs_updated_at on public.medication_logs;
create trigger medication_logs_updated_at before update on public.medication_logs for each row execute function public.set_updated_at();
drop trigger if exists medication_logs_owner on public.medication_logs;
create trigger medication_logs_owner before insert or update on public.medication_logs for each row execute function public.sync_med_log_owner();
drop trigger if exists reminders_updated_at on public.reminders;
create trigger reminders_updated_at before update on public.reminders for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.goal_logs enable row level security;
alter table public.medications enable row level security;
alter table public.medication_schedules enable row level security;
alter table public.medication_logs enable row level security;
alter table public.reminders enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (public.can_manage_user(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (public.can_manage_user(id)) with check (public.can_manage_user(id));

drop policy if exists goals_all on public.goals;
create policy goals_all on public.goals for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

drop policy if exists goal_logs_all on public.goal_logs;
create policy goal_logs_all on public.goal_logs for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

drop policy if exists medications_all on public.medications;
create policy medications_all on public.medications for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

drop policy if exists schedules_all on public.medication_schedules;
create policy schedules_all on public.medication_schedules for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

drop policy if exists medication_logs_all on public.medication_logs;
create policy medication_logs_all on public.medication_logs for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

drop policy if exists reminders_all on public.reminders;
create policy reminders_all on public.reminders for all to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));

revoke all on function public.claim_first_admin(text) from public;
grant execute on function public.claim_first_admin(text) to authenticated;
grant execute on function public.admin_initialized() to anon, authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.can_manage_user(uuid) to authenticated;

create index if not exists profiles_manager_id_idx on public.profiles(manager_id);
create index if not exists goals_owner_idx on public.goals(owner_id);
create index if not exists goal_logs_owner_date_idx on public.goal_logs(owner_id, log_date desc);
create index if not exists medications_owner_idx on public.medications(owner_id);
create index if not exists schedules_owner_idx on public.medication_schedules(owner_id);
create index if not exists med_logs_owner_date_idx on public.medication_logs(owner_id, log_date desc);
create index if not exists reminders_owner_idx on public.reminders(owner_id);

commit;
