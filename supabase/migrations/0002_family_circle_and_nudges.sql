begin;

create or replace function public.family_root_id(p_uid uuid)
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

create or replace function public.is_same_family(target_uid uuid, viewer_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select viewer_uid is not null
    and public.family_root_id(target_uid) is not null
    and public.family_root_id(target_uid) = public.family_root_id(viewer_uid);
$$;

revoke all on function public.family_root_id(uuid) from public;
revoke all on function public.is_same_family(uuid, uuid) from public;
grant execute on function public.family_root_id(uuid) to authenticated;
grant execute on function public.is_same_family(uuid, uuid) to authenticated;

-- Family members may see each other's health status, while write access stays
-- restricted to the owner and the family administrator.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (public.is_same_family(id));

-- Replace the old broad ALL policies with separate read/write policies.
drop policy if exists goals_all on public.goals;
drop policy if exists goals_select_family on public.goals;
drop policy if exists goals_insert_manage on public.goals;
drop policy if exists goals_update_manage on public.goals;
drop policy if exists goals_delete_manage on public.goals;
create policy goals_select_family on public.goals for select to authenticated
using (public.is_same_family(owner_id));
create policy goals_insert_manage on public.goals for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy goals_update_manage on public.goals for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy goals_delete_manage on public.goals for delete to authenticated
using (public.can_manage_user(owner_id));

drop policy if exists goal_logs_all on public.goal_logs;
drop policy if exists goal_logs_select_family on public.goal_logs;
drop policy if exists goal_logs_insert_manage on public.goal_logs;
drop policy if exists goal_logs_update_manage on public.goal_logs;
drop policy if exists goal_logs_delete_manage on public.goal_logs;
create policy goal_logs_select_family on public.goal_logs for select to authenticated
using (public.is_same_family(owner_id));
create policy goal_logs_insert_manage on public.goal_logs for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy goal_logs_update_manage on public.goal_logs for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy goal_logs_delete_manage on public.goal_logs for delete to authenticated
using (public.can_manage_user(owner_id));

drop policy if exists medications_all on public.medications;
drop policy if exists medications_select_family on public.medications;
drop policy if exists medications_insert_manage on public.medications;
drop policy if exists medications_update_manage on public.medications;
drop policy if exists medications_delete_manage on public.medications;
create policy medications_select_family on public.medications for select to authenticated
using (public.is_same_family(owner_id));
create policy medications_insert_manage on public.medications for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy medications_update_manage on public.medications for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy medications_delete_manage on public.medications for delete to authenticated
using (public.can_manage_user(owner_id));

drop policy if exists schedules_all on public.medication_schedules;
drop policy if exists schedules_select_family on public.medication_schedules;
drop policy if exists schedules_insert_manage on public.medication_schedules;
drop policy if exists schedules_update_manage on public.medication_schedules;
drop policy if exists schedules_delete_manage on public.medication_schedules;
create policy schedules_select_family on public.medication_schedules for select to authenticated
using (public.is_same_family(owner_id));
create policy schedules_insert_manage on public.medication_schedules for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy schedules_update_manage on public.medication_schedules for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy schedules_delete_manage on public.medication_schedules for delete to authenticated
using (public.can_manage_user(owner_id));

drop policy if exists medication_logs_all on public.medication_logs;
drop policy if exists medication_logs_select_family on public.medication_logs;
drop policy if exists medication_logs_insert_manage on public.medication_logs;
drop policy if exists medication_logs_update_manage on public.medication_logs;
drop policy if exists medication_logs_delete_manage on public.medication_logs;
create policy medication_logs_select_family on public.medication_logs for select to authenticated
using (public.is_same_family(owner_id));
create policy medication_logs_insert_manage on public.medication_logs for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy medication_logs_update_manage on public.medication_logs for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy medication_logs_delete_manage on public.medication_logs for delete to authenticated
using (public.can_manage_user(owner_id));

drop policy if exists reminders_all on public.reminders;
drop policy if exists reminders_select_family on public.reminders;
drop policy if exists reminders_insert_manage on public.reminders;
drop policy if exists reminders_update_manage on public.reminders;
drop policy if exists reminders_delete_manage on public.reminders;
create policy reminders_select_family on public.reminders for select to authenticated
using (public.is_same_family(owner_id));
create policy reminders_insert_manage on public.reminders for insert to authenticated
with check (public.can_manage_user(owner_id));
create policy reminders_update_manage on public.reminders for update to authenticated
using (public.can_manage_user(owner_id)) with check (public.can_manage_user(owner_id));
create policy reminders_delete_manage on public.reminders for delete to authenticated
using (public.can_manage_user(owner_id));

create table if not exists public.family_nudges (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  medication_schedule_id uuid references public.medication_schedules(id) on delete set null,
  message text not null check (char_length(trim(message)) between 1 and 240),
  status text not null default 'pending' check (status in ('pending','read')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

alter table public.family_nudges enable row level security;

drop policy if exists family_nudges_select on public.family_nudges;
create policy family_nudges_select on public.family_nudges for select to authenticated
using (
  sender_id = auth.uid()
  or recipient_id = auth.uid()
  or (public.is_admin(auth.uid()) and public.is_same_family(recipient_id))
);

drop policy if exists family_nudges_insert on public.family_nudges;
create policy family_nudges_insert on public.family_nudges for insert to authenticated
with check (
  sender_id = auth.uid()
  and public.is_same_family(recipient_id)
  and recipient_id <> auth.uid()
);

drop policy if exists family_nudges_update on public.family_nudges;
create policy family_nudges_update on public.family_nudges for update to authenticated
using (public.can_manage_user(recipient_id))
with check (public.can_manage_user(recipient_id));

drop policy if exists family_nudges_delete on public.family_nudges;
create policy family_nudges_delete on public.family_nudges for delete to authenticated
using (sender_id = auth.uid() or public.can_manage_user(recipient_id));

create index if not exists family_nudges_recipient_status_idx
on public.family_nudges(recipient_id, status, created_at desc);
create index if not exists family_nudges_sender_idx
on public.family_nudges(sender_id, created_at desc);

grant select, insert, update, delete on public.family_nudges to authenticated;

commit;
