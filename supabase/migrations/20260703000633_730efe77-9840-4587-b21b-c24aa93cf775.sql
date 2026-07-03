
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- admin_accounts
CREATE TABLE public.admin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username extensions.CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.admin_accounts(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_accounts TO service_role;
ALTER TABLE public.admin_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_accounts no direct access" ON public.admin_accounts
  FOR ALL USING (false) WITH CHECK (false);
CREATE TRIGGER admin_accounts_updated_at
  BEFORE UPDATE ON public.admin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.protect_super_admin()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
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
END; $$;
CREATE TRIGGER admin_accounts_protect_super
  BEFORE UPDATE OR DELETE ON public.admin_accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_super_admin();

-- admin_sessions
CREATE TABLE public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.admin_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_idx ON public.admin_sessions(admin_id);
CREATE INDEX admin_sessions_expires_idx ON public.admin_sessions(expires_at);
GRANT ALL ON public.admin_sessions TO service_role;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_sessions no direct access" ON public.admin_sessions
  FOR ALL USING (false) WITH CHECK (false);

-- admin_audit_log
CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_id UUID REFERENCES public.admin_accounts(id) ON DELETE SET NULL,
  actor_username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON public.admin_audit_log(created_at DESC);
CREATE INDEX admin_audit_actor_idx ON public.admin_audit_log(actor_admin_id);
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_audit_log no direct access" ON public.admin_audit_log
  FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.protect_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'The audit log cannot be modified'; END; $$;
CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.protect_audit_log();

-- Verify credentials
CREATE OR REPLACE FUNCTION public.admin_verify_credentials(_username TEXT, _password TEXT)
RETURNS TABLE(id UUID, username TEXT, is_super_admin BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.username::text, a.is_super_admin
  FROM public.admin_accounts a
  WHERE a.username = _username::extensions.citext
    AND a.disabled = FALSE
    AND a.password_hash = extensions.crypt(_password, a.password_hash);
END; $$;
REVOKE ALL ON FUNCTION public.admin_verify_credentials(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_verify_credentials(TEXT, TEXT) TO service_role;

-- Hash a password (bcrypt cost 12)
CREATE OR REPLACE FUNCTION public.admin_hash_password(_password TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
  SELECT extensions.crypt(_password, extensions.gen_salt('bf', 12));
$$;
REVOKE ALL ON FUNCTION public.admin_hash_password(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_hash_password(TEXT) TO service_role;

-- Seed Arthur
INSERT INTO public.admin_accounts (username, password_hash, is_super_admin)
VALUES ('Arthur', extensions.crypt('SuomenParas67!', extensions.gen_salt('bf', 12)), TRUE)
ON CONFLICT (username) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      is_super_admin = TRUE,
      disabled = FALSE;

INSERT INTO public.admin_audit_log (actor_username, action, target_type, new_values, reason)
VALUES ('system', 'super_admin_seeded', 'admin_account',
        jsonb_build_object('username','Arthur','is_super_admin',true),
        'Initial migration');
