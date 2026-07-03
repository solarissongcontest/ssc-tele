
REVOKE EXECUTE ON FUNCTION public.admin_verify_credentials(TEXT, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_hash_password(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN RAISE EXCEPTION 'The audit log cannot be modified'; END;
$$;

CREATE OR REPLACE FUNCTION public.protect_super_admin()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_super_admin THEN RAISE EXCEPTION 'The Super Admin account cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_super_admin THEN
    IF NEW.is_super_admin = FALSE THEN RAISE EXCEPTION 'The Super Admin cannot be demoted'; END IF;
    IF NEW.disabled = TRUE THEN RAISE EXCEPTION 'The Super Admin cannot be disabled'; END IF;
    IF NEW.username <> OLD.username THEN RAISE EXCEPTION 'The Super Admin username cannot be changed'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
