begin;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists email_confirmed_at timestamptz;
alter table public.profiles add column if not exists account_status text not null default 'approved';
alter table public.profiles add column if not exists is_platform_admin boolean not null default false;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists rejected_at timestamptz;
alter table public.profiles add column if not exists rejection_reason text;

do $$ begin
  alter table public.profiles add constraint profiles_account_status_check
  check (account_status in ('pending','approved','rejected'));
exception when duplicate_object then null;
end $$;

update public.profiles p
set email = u.email,
    email_confirmed_at = u.email_confirmed_at,
    account_status = 'approved',
    is_active = true,
    approved_at = coalesce(p.approved_at, p.created_at)
from auth.users u
where u.id = p.id;

-- Mansour is the platform administrator who reviews independent registrations.
update public.profiles
set is_platform_admin = true,
    account_status = 'approved',
    is_active = true,
    approved_at = coalesce(approved_at, now())
where id = '720ccdba-6941-4dfc-ae3a-deeac73f6872';

create or replace function private.is_platform_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and is_platform_admin = true
      and account_status = 'approved'
      and is_active = true
  );
$$;

create or replace function private.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role = 'admin'
      and account_status = 'approved'
      and is_active = true
  );
$$;

create or replace function private.can_manage_user(target_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and me.account_status = 'approved'
      and me.is_active = true
      and (
        target_uid = me.id
        or (
          me.role = 'admin'
          and exists (
            select 1 from public.profiles member
            where member.id = target_uid
              and member.manager_id = me.id
              and member.account_status = 'approved'
              and member.is_active = true
          )
        )
      )
  );
$$;

create or replace function private.family_root_id(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role = 'admin' then p.id else p.manager_id end
  from public.profiles p
  where p.id = p_uid
    and p.account_status = 'approved'
    and p.is_active = true
  limit 1;
$$;

create or replace function private.is_same_family(target_uid uuid, viewer_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select viewer_uid is not null
    and private.family_root_id(target_uid) is not null
    and private.family_root_id(target_uid) = private.family_root_id(viewer_uid);
$$;

revoke all on function private.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_platform_admin(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter_id uuid;
  inviter_is_admin boolean := false;
begin
  begin
    inviter_id := nullif(new.raw_user_meta_data->>'invited_by', '')::uuid;
  exception when invalid_text_representation then
    inviter_id := null;
  end;

  if inviter_id is not null then
    select exists(
      select 1 from public.profiles
      where id = inviter_id
        and role = 'admin'
        and account_status = 'approved'
        and is_active = true
    ) into inviter_is_admin;
  end if;

  insert into public.profiles (
    id, full_name, email, email_confirmed_at, role, manager_id,
    account_status, is_active, approved_at, approved_by
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    new.email_confirmed_at,
    case when inviter_is_admin then 'member'::public.app_role else 'admin'::public.app_role end,
    case when inviter_is_admin then inviter_id else null end,
    case when inviter_is_admin then 'approved' else 'pending' end,
    inviter_is_admin,
    case when inviter_is_admin then now() else null end,
    case when inviter_is_admin then inviter_id else null end
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        email_confirmed_at = excluded.email_confirmed_at,
        role = excluded.role,
        manager_id = excluded.manager_id,
        account_status = excluded.account_status,
        is_active = excluded.is_active,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        rejected_at = null,
        rejection_reason = null,
        updated_at = now();

  return new;
end;
$$;

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email,
      email_confirmed_at = new.email_confirmed_at,
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_profile_sync on auth.users;
create trigger on_auth_user_profile_sync
after update of email, email_confirmed_at on auth.users
for each row execute function public.sync_auth_user_profile();

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_auth_user_profile() from public, anon, authenticated;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is not null and not private.is_platform_admin(auth.uid()) then
    new.role := old.role;
    new.manager_id := old.manager_id;
    new.is_active := old.is_active;
    new.account_status := old.account_status;
    new.is_platform_admin := old.is_platform_admin;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
    new.rejected_at := old.rejected_at;
    new.rejection_reason := old.rejection_reason;
    new.email := old.email;
    new.email_confirmed_at := old.email_confirmed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_fields() from public, anon, authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or private.is_platform_admin(auth.uid())
  or private.is_same_family(id)
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (
  private.is_platform_admin(auth.uid())
  or private.can_manage_user(id)
)
with check (
  private.is_platform_admin(auth.uid())
  or private.can_manage_user(id)
);

create or replace function public.review_registration(
  p_target_uid uuid,
  p_decision text,
  p_reason text default null
)
returns public.profiles
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  result public.profiles;
begin
  if not private.is_platform_admin(auth.uid()) then
    raise exception 'platform admin access required';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'invalid decision';
  end if;

  if p_decision = 'approved' and not exists (
    select 1 from public.profiles
    where id = p_target_uid and email_confirmed_at is not null
  ) then
    raise exception 'email must be confirmed before approval';
  end if;

  update public.profiles
  set account_status = p_decision,
      is_active = (p_decision = 'approved'),
      approved_at = case when p_decision = 'approved' then now() else null end,
      approved_by = case when p_decision = 'approved' then auth.uid() else null end,
      rejected_at = case when p_decision = 'rejected' then now() else null end,
      rejection_reason = case when p_decision = 'rejected' then nullif(trim(p_reason), '') else null end,
      updated_at = now()
  where id = p_target_uid
    and role = 'admin'
    and manager_id is null
    and is_platform_admin = false
  returning * into result;

  if result.id is null then
    raise exception 'registration not found';
  end if;

  return result;
end;
$$;

revoke all on function public.review_registration(uuid,text,text) from public, anon;
grant execute on function public.review_registration(uuid,text,text) to authenticated;

create index if not exists profiles_account_status_idx
on public.profiles(account_status, created_at desc);
create index if not exists profiles_platform_admin_idx
on public.profiles(is_platform_admin)
where is_platform_admin = true;

commit;
