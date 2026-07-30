begin;

-- Custom email verification flow used by the Resend Edge Functions.
-- The Resend API key must be stored separately in Supabase Vault with the name:
-- healthy_life_resend_api_key

create table if not exists private.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null check (purpose in ('signup','family_invite')),
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  delivered_at timestamptz,
  locked_at timestamptz,
  request_ip inet,
  delivery_provider text,
  delivery_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_lookup_idx
on private.email_verification_codes (email, purpose, created_at desc);

create index if not exists email_verification_user_purpose_idx
on private.email_verification_codes (user_id, purpose, created_at desc);

create index if not exists email_verification_active_idx
on private.email_verification_codes (expires_at)
where consumed_at is null;

alter table private.email_verification_codes enable row level security;
revoke all on table private.email_verification_codes from public, anon, authenticated;

create table if not exists private.email_sender_settings (
  id boolean primary key default true check (id = true),
  provider text not null default 'resend',
  from_email text not null,
  from_name text not null,
  app_url text not null,
  updated_at timestamptz not null default now()
);

insert into private.email_sender_settings (id, provider, from_email, from_name, app_url)
values (
  true,
  'resend',
  'no-reply@mailpilot.my',
  'صحتي العائلية',
  'https://mansour-cyber.github.io/healthy-life/'
)
on conflict (id) do update
set provider = excluded.provider,
    from_email = excluded.from_email,
    from_name = excluded.from_name,
    app_url = excluded.app_url,
    updated_at = now();

alter table private.email_sender_settings enable row level security;
revoke all on table private.email_sender_settings from public, anon, authenticated;

create or replace function public.issue_email_verification(
  p_user_id uuid,
  p_email text,
  p_purpose text,
  p_code text,
  p_request_ip inet default null
)
returns void
language plpgsql
security definer
set search_path = private, public, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  recent_count integer;
  ip_recent_count integer;
begin
  if p_purpose not in ('signup','family_invite') then
    raise exception 'invalid verification purpose';
  end if;

  if p_code !~ '^[0-9]{6}$' then
    raise exception 'invalid verification code';
  end if;

  if not exists (
    select 1 from auth.users
    where id = p_user_id and lower(email) = normalized_email
  ) then
    raise exception 'user not found';
  end if;

  if exists (
    select 1
    from private.email_verification_codes
    where email = normalized_email
      and purpose = p_purpose
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'please wait before requesting another code';
  end if;

  select count(*) into recent_count
  from private.email_verification_codes
  where email = normalized_email
    and purpose = p_purpose
    and created_at > now() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'too many verification requests';
  end if;

  if p_request_ip is not null then
    select count(*) into ip_recent_count
    from private.email_verification_codes
    where request_ip = p_request_ip
      and created_at > now() - interval '1 hour';

    if ip_recent_count >= 20 then
      raise exception 'too many requests from this address';
    end if;
  end if;

  update private.email_verification_codes
  set consumed_at = now()
  where email = normalized_email
    and purpose = p_purpose
    and consumed_at is null;

  insert into private.email_verification_codes (
    user_id, email, purpose, code_hash, expires_at, request_ip
  ) values (
    p_user_id,
    normalized_email,
    p_purpose,
    crypt(p_code, gen_salt('bf', 8)),
    now() + interval '10 minutes',
    p_request_ip
  );
end;
$$;

create or replace function public.issue_email_verification(
  p_user_id uuid,
  p_email text,
  p_purpose text,
  p_code text
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.issue_email_verification(
    p_user_id,
    p_email,
    p_purpose,
    p_code,
    null::inet
  );
$$;

create or replace function public.consume_email_verification(
  p_email text,
  p_purpose text,
  p_code text
)
returns table(success boolean, user_id uuid, reason text)
language plpgsql
security definer
set search_path = private, public, extensions
as $$
declare
  normalized_email text := lower(trim(p_email));
  verification private.email_verification_codes%rowtype;
begin
  select * into verification
  from private.email_verification_codes
  where email = normalized_email
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if verification.id is null then
    return query select false, null::uuid, 'expired_or_missing'::text;
    return;
  end if;

  if verification.locked_at is not null or verification.attempts >= 5 then
    return query select false, null::uuid, 'too_many_attempts'::text;
    return;
  end if;

  if crypt(p_code, verification.code_hash) = verification.code_hash then
    update private.email_verification_codes
    set consumed_at = now()
    where id = verification.id;

    return query select true, verification.user_id, null::text;
    return;
  end if;

  update private.email_verification_codes
  set attempts = attempts + 1,
      locked_at = case when attempts + 1 >= 5 then now() else locked_at end
  where id = verification.id;

  return query select false, null::uuid,
    case
      when verification.attempts + 1 >= 5 then 'too_many_attempts'
      else 'invalid_code'
    end::text;
end;
$$;

create or replace function public.mark_email_verification_delivered(
  p_user_id uuid,
  p_email text,
  p_purpose text,
  p_provider text default 'resend',
  p_message_id text default null
)
returns void
language sql
security definer
set search_path = private, public
as $$
  update private.email_verification_codes
  set delivered_at = now(),
      delivery_provider = p_provider,
      delivery_message_id = p_message_id
  where id = (
    select id
    from private.email_verification_codes
    where user_id = p_user_id
      and email = lower(trim(p_email))
      and purpose = p_purpose
      and consumed_at is null
    order by created_at desc
    limit 1
  );
$$;

create or replace function public.cleanup_email_verification_codes()
returns integer
language plpgsql
security definer
set search_path = private, public
as $$
declare
  deleted_count integer;
begin
  delete from private.email_verification_codes
  where created_at < now() - interval '24 hours';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.get_healthy_life_resend_key()
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'healthy_life_resend_api_key'
  limit 1;
$$;

create or replace function public.get_healthy_life_email_settings()
returns table(provider text, from_email text, from_name text, app_url text)
language sql
security definer
set search_path = private, public
as $$
  select s.provider, s.from_email, s.from_name, s.app_url
  from private.email_sender_settings s
  where s.id = true;
$$;

revoke all on function public.issue_email_verification(uuid,text,text,text,inet) from public, anon, authenticated;
revoke all on function public.issue_email_verification(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.consume_email_verification(text,text,text) from public, anon, authenticated;
revoke all on function public.mark_email_verification_delivered(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.cleanup_email_verification_codes() from public, anon, authenticated;
revoke all on function public.get_healthy_life_resend_key() from public, anon, authenticated;
revoke all on function public.get_healthy_life_email_settings() from public, anon, authenticated;

grant execute on function public.issue_email_verification(uuid,text,text,text,inet) to service_role;
grant execute on function public.issue_email_verification(uuid,text,text,text) to service_role;
grant execute on function public.consume_email_verification(text,text,text) to service_role;
grant execute on function public.mark_email_verification_delivered(uuid,text,text,text,text) to service_role;
grant execute on function public.cleanup_email_verification_codes() to service_role;
grant execute on function public.get_healthy_life_resend_key() to service_role;
grant execute on function public.get_healthy_life_email_settings() to service_role;

commit;
