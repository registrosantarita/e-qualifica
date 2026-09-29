REVOKE EXECUTE ON FUNCTION public.is_authorized_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_unapproved_signup() FROM PUBLIC, anon, authenticated;