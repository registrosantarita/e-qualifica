CREATE OR REPLACE FUNCTION public.is_authorized_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.authorized_emails a ON a.email = lower(btrim(u.email))
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = _user_id AND p.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION public.is_authorized_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_authorized_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_unapproved_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.authorized_emails WHERE email = lower(btrim(NEW.email))) THEN
    RAISE EXCEPTION 'Email não autorizado para cadastro';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_authorized_signup BEFORE INSERT OR UPDATE OF email ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_unapproved_signup();

CREATE OR REPLACE FUNCTION public.prevent_profile_access_escalation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Dados de acesso não podem ser alterados pelo perfil';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_profile_access BEFORE UPDATE ON public.profiles
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.prevent_profile_access_escalation();

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_authorized_user(_user_id) AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;
CREATE OR REPLACE FUNCTION public.can_access_analysis(_analysis_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_authorized_user(_user_id) AND EXISTS (
    SELECT 1 FROM public.analyses a
    WHERE a.id = _analysis_id
      AND (a.created_by = _user_id OR a.responsible_user_id = _user_id OR public.has_role(_user_id,'admin'))
  )
$$;

ALTER POLICY "profiles_select_own" ON public.profiles USING (id = auth.uid() AND public.is_authorized_user(auth.uid()));
ALTER POLICY "profiles_update_own" ON public.profiles USING (id = auth.uid() AND public.is_authorized_user(auth.uid())) WITH CHECK (id = auth.uid() AND public.is_authorized_user(auth.uid()));
ALTER POLICY "user_roles_select_own" ON public.user_roles USING (user_id = auth.uid() AND public.is_authorized_user(auth.uid()));
ALTER POLICY "analyses_select" ON public.analyses USING (public.is_authorized_user(auth.uid()) AND (created_by = auth.uid() OR responsible_user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));
ALTER POLICY "analyses_insert" ON public.analyses WITH CHECK (public.is_authorized_user(auth.uid()) AND created_by = auth.uid());
ALTER POLICY "analyses_update" ON public.analyses USING (public.is_authorized_user(auth.uid()) AND (created_by = auth.uid() OR responsible_user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))) WITH CHECK (public.is_authorized_user(auth.uid()) AND (created_by = auth.uid() OR responsible_user_id = auth.uid() OR public.has_role(auth.uid(),'admin')));
ALTER POLICY "analyses_delete" ON public.analyses USING (public.is_authorized_user(auth.uid()) AND (created_by = auth.uid() OR public.has_role(auth.uid(),'admin')));
ALTER POLICY "audit_select" ON public.audit_logs USING (public.is_authorized_user(auth.uid()) AND (actor_id = auth.uid() OR public.has_role(auth.uid(),'admin')));
ALTER POLICY "audit_insert" ON public.audit_logs WITH CHECK (public.is_authorized_user(auth.uid()) AND actor_id = auth.uid());

DO $$
DECLARE r record; expr text;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public'
    AND tablename NOT IN ('authorized_emails','profiles','user_roles','analyses','audit_logs')
  LOOP
    IF r.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND r.qual IS NOT NULL THEN
      expr := '(public.is_authorized_user(auth.uid()) AND (' || r.qual || '))';
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',r.policyname,r.schemaname,r.tablename,expr);
    END IF;
    IF r.cmd IN ('INSERT','UPDATE','ALL') AND r.with_check IS NOT NULL THEN
      expr := '(public.is_authorized_user(auth.uid()) AND (' || r.with_check || '))';
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',r.policyname,r.schemaname,r.tablename,expr);
    END IF;
  END LOOP;
END $$;

CREATE POLICY "documentos_authorized" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (bucket_id <> 'documentos' OR public.is_authorized_user(auth.uid()))
WITH CHECK (bucket_id <> 'documentos' OR public.is_authorized_user(auth.uid()));