begin;

-- Public registration no longer uses the legacy first-admin bootstrap. Keep the
-- compatibility RPC for the original frontend bootstrap without elevated access.
create or replace function public.admin_initialized()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select true;
$$;

revoke all on function public.admin_initialized() from public;
grant execute on function public.admin_initialized() to anon, authenticated;

commit;
