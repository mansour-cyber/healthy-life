begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_admin(uid uuid default auth.uid())
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

create or replace function private.can_manage_user(target_uid uuid)
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

create or replace function private.family_root_id(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role = 'admin' then p.id else p.manager_id end
  from public.profiles p
  where p.id = p_uid and p.is_active = true
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

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.can_manage_user(uuid) to authenticated;
grant execute on function private.family_root_id(uuid) to authenticated;
grant execute on function private.is_same_family(uuid, uuid) to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (private.is_same_family(id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (private.can_manage_user(id)) with check (private.can_manage_user(id));

drop policy if exists goals_select_family on public.goals;
drop policy if exists goals_insert_manage on public.goals;
drop policy if exists goals_update_manage on public.goals;
drop policy if exists goals_delete_manage on public.goals;
create policy goals_select_family on public.goals for select to authenticated using (private.is_same_family(owner_id));
create policy goals_insert_manage on public.goals for insert to authenticated with check (private.can_manage_user(owner_id));
create policy goals_update_manage on public.goals for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy goals_delete_manage on public.goals for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists goal_logs_select_family on public.goal_logs;
drop policy if exists goal_logs_insert_manage on public.goal_logs;
drop policy if exists goal_logs_update_manage on public.goal_logs;
drop policy if exists goal_logs_delete_manage on public.goal_logs;
create policy goal_logs_select_family on public.goal_logs for select to authenticated using (private.is_same_family(owner_id));
create policy goal_logs_insert_manage on public.goal_logs for insert to authenticated with check (private.can_manage_user(owner_id));
create policy goal_logs_update_manage on public.goal_logs for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy goal_logs_delete_manage on public.goal_logs for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists medications_select_family on public.medications;
drop policy if exists medications_insert_manage on public.medications;
drop policy if exists medications_update_manage on public.medications;
drop policy if exists medications_delete_manage on public.medications;
create policy medications_select_family on public.medications for select to authenticated using (private.is_same_family(owner_id));
create policy medications_insert_manage on public.medications for insert to authenticated with check (private.can_manage_user(owner_id));
create policy medications_update_manage on public.medications for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy medications_delete_manage on public.medications for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists schedules_select_family on public.medication_schedules;
drop policy if exists schedules_insert_manage on public.medication_schedules;
drop policy if exists schedules_update_manage on public.medication_schedules;
drop policy if exists schedules_delete_manage on public.medication_schedules;
create policy schedules_select_family on public.medication_schedules for select to authenticated using (private.is_same_family(owner_id));
create policy schedules_insert_manage on public.medication_schedules for insert to authenticated with check (private.can_manage_user(owner_id));
create policy schedules_update_manage on public.medication_schedules for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy schedules_delete_manage on public.medication_schedules for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists medication_logs_select_family on public.medication_logs;
drop policy if exists medication_logs_insert_manage on public.medication_logs;
drop policy if exists medication_logs_update_manage on public.medication_logs;
drop policy if exists medication_logs_delete_manage on public.medication_logs;
create policy medication_logs_select_family on public.medication_logs for select to authenticated using (private.is_same_family(owner_id));
create policy medication_logs_insert_manage on public.medication_logs for insert to authenticated with check (private.can_manage_user(owner_id));
create policy medication_logs_update_manage on public.medication_logs for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy medication_logs_delete_manage on public.medication_logs for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists reminders_select_family on public.reminders;
drop policy if exists reminders_insert_manage on public.reminders;
drop policy if exists reminders_update_manage on public.reminders;
drop policy if exists reminders_delete_manage on public.reminders;
create policy reminders_select_family on public.reminders for select to authenticated using (private.is_same_family(owner_id));
create policy reminders_insert_manage on public.reminders for insert to authenticated with check (private.can_manage_user(owner_id));
create policy reminders_update_manage on public.reminders for update to authenticated using (private.can_manage_user(owner_id)) with check (private.can_manage_user(owner_id));
create policy reminders_delete_manage on public.reminders for delete to authenticated using (private.can_manage_user(owner_id));

drop policy if exists family_nudges_select on public.family_nudges;
create policy family_nudges_select on public.family_nudges for select to authenticated
using (sender_id = auth.uid() or recipient_id = auth.uid() or (private.is_admin(auth.uid()) and private.is_same_family(recipient_id)));

drop policy if exists family_nudges_insert on public.family_nudges;
create policy family_nudges_insert on public.family_nudges for insert to authenticated
with check (sender_id = auth.uid() and private.is_same_family(recipient_id) and recipient_id <> auth.uid());

drop policy if exists family_nudges_update on public.family_nudges;
create policy family_nudges_update on public.family_nudges for update to authenticated
using (private.can_manage_user(recipient_id)) with check (private.can_manage_user(recipient_id));

drop policy if exists family_nudges_delete on public.family_nudges;
create policy family_nudges_delete on public.family_nudges for delete to authenticated
using (sender_id = auth.uid() or private.can_manage_user(recipient_id));

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id and not private.is_admin(auth.uid()) then
    new.role := old.role;
    new.manager_id := old.manager_id;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

alter function public.set_updated_at() set search_path = public;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.protect_profile_fields() from public, anon, authenticated;
revoke all on function public.sync_goal_log_owner() from public, anon, authenticated;
revoke all on function public.sync_schedule_owner() from public, anon, authenticated;
revoke all on function public.sync_med_log_owner() from public, anon, authenticated;

revoke all on function public.claim_first_admin(text) from public, anon, authenticated;
grant execute on function public.claim_first_admin(text) to authenticated;

revoke all on function public.admin_initialized() from public, anon, authenticated;
grant execute on function public.admin_initialized() to anon, authenticated;

drop function if exists public.is_same_family(uuid, uuid);
drop function if exists public.family_root_id(uuid);
drop function if exists public.can_manage_user(uuid);
drop function if exists public.is_admin(uuid);

commit;
