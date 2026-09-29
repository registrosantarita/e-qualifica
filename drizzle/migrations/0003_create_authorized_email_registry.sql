CREATE TABLE public.authorized_emails (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) > 3),
  full_name text NOT NULL DEFAULT '',
  role public.app_role NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.authorized_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.authorized_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.authorized_emails TO service_role;
COMMENT ON TABLE public.authorized_emails IS 'Approved accounts. Access checks always compare against the current email in auth.users, not mutable profile data.';