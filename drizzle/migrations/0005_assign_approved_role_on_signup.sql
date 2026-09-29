CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE approved_role public.app_role;
BEGIN
  SELECT role INTO approved_role FROM public.authorized_emails
  WHERE email = lower(btrim(NEW.email));
  IF approved_role IS NULL THEN
    RAISE EXCEPTION 'Email não autorizado para cadastro';
  END IF;
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, approved_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;