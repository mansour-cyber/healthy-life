-- Keep the public RPC as SECURITY INVOKER and move privileged deletion into a private schema.

create or replace function private.review_registration_privileged(
  p_target_uid uuid,
  p_decision text,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, private, auth
as $$
declare
  result public.profiles;
begin
  if not private.is_platform_admin(auth.uid()) then
    raise exception 'platform admin access required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  select * into result
  from public.profiles
  where id = p_target_uid
    and role = 'admin'
    and manager_id is null
    and is_platform_admin = false
    and account_status in ('pending', 'rejected');

  if result.id is null then
    raise exception 'registration not found';
  end if;

  if p_decision = 'rejected' then
    delete from auth.users where id = p_target_uid;

    if found then
      return result;
    end if;

    raise exception 'registration deletion failed';
  end if;

  if result.email_confirmed_at is null then
    raise exception 'email must be confirmed before approval';
  end if;

  update public.profiles
  set account_status = 'approved',
      is_active = true,
      approved_at = now(),
      approved_by = auth.uid(),
      rejected_at = null,
      rejection_reason = null,
      updated_at = now()
  where id = p_target_uid
  returning * into result;

  return result;
end;
$$;

revoke all on function private.review_registration_privileged(uuid, text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.review_registration_privileged(uuid, text, text) to authenticated;

create or replace function public.review_registration(
  p_target_uid uuid,
  p_decision text,
  p_reason text default null
)
returns public.profiles
language sql
security invoker
set search_path = public, private
as $$
  select private.review_registration_privileged(p_target_uid, p_decision, p_reason);
$$;

revoke all on function public.review_registration(uuid, text, text) from public, anon;
grant execute on function public.review_registration(uuid, text, text) to authenticated;
