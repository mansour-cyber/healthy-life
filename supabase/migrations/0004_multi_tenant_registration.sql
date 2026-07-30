begin;

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
      where id = inviter_id and role = 'admin' and is_active = true
    ) into inviter_is_admin;
  end if;

  insert into public.profiles (id, full_name, role, manager_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when inviter_is_admin then 'member'::public.app_role else 'admin'::public.app_role end,
    case when inviter_is_admin then inviter_id else null end
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = excluded.role,
        manager_id = excluded.manager_id,
        is_active = true,
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Existing test account Ahmad must be an independent account, not a member of Mansour's family.
update public.profiles
set role = 'admin', manager_id = null, updated_at = now()
where id = '80096fde-ed5a-487a-872a-39b43451427a';

commit;
