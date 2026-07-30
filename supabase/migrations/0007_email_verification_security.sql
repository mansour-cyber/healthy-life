begin;

-- The legacy first-admin bootstrap is no longer used by the public registration flow.
revoke all on function public.claim_first_admin(text) from public, anon, authenticated;

-- Explicit deny policies keep implementation tables private even if schema
-- exposure changes in the future. Database-owner SECURITY DEFINER functions
-- continue to bypass RLS as intended.
drop policy if exists email_verification_codes_deny_all on private.email_verification_codes;
create policy email_verification_codes_deny_all
on private.email_verification_codes
for all
to public
using (false)
with check (false);

drop policy if exists email_sender_settings_deny_all on private.email_sender_settings;
create policy email_sender_settings_deny_all
on private.email_sender_settings
for all
to public
using (false)
with check (false);

commit;
