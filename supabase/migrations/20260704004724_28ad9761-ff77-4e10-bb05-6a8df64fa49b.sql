
-- 1. Add moderation columns to vote_submissions
ALTER TABLE public.vote_submissions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ip_country text,
  ADD COLUMN IF NOT EXISTS is_vpn boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moderator_note text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid;

ALTER TABLE public.vote_submissions
  DROP CONSTRAINT IF EXISTS vote_submissions_status_check;
ALTER TABLE public.vote_submissions
  ADD CONSTRAINT vote_submissions_status_check
  CHECK (status IN ('active','suspicious','verified','deleted'));

-- 2. Replace uniqueness indexes so deleted rows do not block re-submission
DROP INDEX IF EXISTS public.idx_vs_round_username;
CREATE UNIQUE INDEX idx_vs_round_username
  ON public.vote_submissions (round_id, username_normalized)
  WHERE status <> 'deleted';

DROP INDEX IF EXISTS public.idx_vs_round_ip;
CREATE UNIQUE INDEX idx_vs_round_ip
  ON public.vote_submissions (round_id, ip_hash)
  WHERE ip_hash IS NOT NULL AND status <> 'deleted';

DROP INDEX IF EXISTS public.idx_vs_round_fp;
CREATE UNIQUE INDEX idx_vs_round_fp
  ON public.vote_submissions (round_id, fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL AND status <> 'deleted';

DROP INDEX IF EXISTS public.idx_vs_round_dt;
CREATE UNIQUE INDEX idx_vs_round_dt
  ON public.vote_submissions (round_id, device_token_hash)
  WHERE device_token_hash IS NOT NULL AND status <> 'deleted';

CREATE INDEX IF NOT EXISTS idx_vs_round_status
  ON public.vote_submissions (round_id, status);
CREATE INDEX IF NOT EXISTS idx_vs_round_risk
  ON public.vote_submissions (round_id, risk_score DESC);

-- 3. Update submit_vote to accept IP country / VPN flag and skip deleted rows
CREATE OR REPLACE FUNCTION public.submit_vote(
  p_round_id uuid,
  p_username text,
  p_country_code text,
  p_entries jsonb,
  p_ip_hash text DEFAULT NULL,
  p_fingerprint_hash text DEFAULT NULL,
  p_device_token_hash text DEFAULT NULL,
  p_ip_country text DEFAULT NULL,
  p_is_vpn boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_round rounds%ROWTYPE;
  v_username_norm text;
  v_total int := 0;
  v_entry jsonb;
  v_tc text;
  v_pts int;
  v_round_codes text[];
  v_seen text[] := ARRAY[]::text[];
  v_sub_id uuid;
  v_count int;
  v_home_exists boolean;
  v_risk int := 0;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 2 THEN
    RAISE EXCEPTION 'Username required' USING ERRCODE='22023';
  END IF;
  v_username_norm := lower(trim(p_username));

  SELECT * INTO v_round FROM rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found' USING ERRCODE='22023'; END IF;
  IF v_round.status <> 'open' THEN RAISE EXCEPTION 'Round is not open' USING ERRCODE='22023'; END IF;

  SELECT array_agg(country_code) INTO v_round_codes FROM round_countries WHERE round_id = p_round_id;
  IF v_round_codes IS NULL OR array_length(v_round_codes,1) < 2 THEN
    RAISE EXCEPTION 'Round has no countries configured' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS(SELECT 1 FROM countries WHERE code = p_country_code) INTO v_home_exists;
  IF NOT v_home_exists THEN
    RAISE EXCEPTION 'Unknown home country' USING ERRCODE='22023';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Invalid entries payload' USING ERRCODE='22023';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_tc := v_entry->>'target_country_code';
    v_pts := (v_entry->>'points')::int;
    IF v_pts IS NULL OR v_pts < 1 OR v_pts > 10 THEN
      RAISE EXCEPTION 'Points must be 1-10' USING ERRCODE='22023';
    END IF;
    IF v_tc = p_country_code THEN
      INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score, metadata)
        VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'self_vote', 80, jsonb_build_object('ip_country', p_ip_country, 'is_vpn', p_is_vpn));
      RAISE EXCEPTION 'Cannot vote for your own country' USING ERRCODE='22023';
    END IF;
    IF NOT (v_tc = ANY(v_round_codes)) THEN
      RAISE EXCEPTION 'Target country not in this round' USING ERRCODE='22023';
    END IF;
    IF v_tc = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate target country' USING ERRCODE='22023';
    END IF;
    v_seen := v_seen || v_tc;
    v_total := v_total + v_pts;
  END LOOP;

  v_count := COALESCE(array_length(v_seen,1),0);

  IF v_total <> 20 THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score, metadata)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'wrong_total_points', 60, jsonb_build_object('total', v_total));
    RAISE EXCEPTION 'Total must be exactly 20 points (got %)', v_total USING ERRCODE='22023';
  END IF;
  IF v_count < 5 THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score, metadata)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'too_few_countries', 50, jsonb_build_object('count', v_count));
    RAISE EXCEPTION 'Vote at least 5 different countries' USING ERRCODE='22023';
  END IF;

  IF EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND username_normalized = v_username_norm AND status <> 'deleted') THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_username', 90);
    RAISE EXCEPTION 'You have already voted in this round' USING ERRCODE='23505';
  END IF;
  IF p_ip_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND ip_hash = p_ip_hash AND status <> 'deleted') THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_ip', 70);
    RAISE EXCEPTION 'A vote from this network was already recorded' USING ERRCODE='23505';
  END IF;
  IF p_fingerprint_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND fingerprint_hash = p_fingerprint_hash AND status <> 'deleted') THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_fingerprint', 80);
    RAISE EXCEPTION 'A vote from this device was already recorded' USING ERRCODE='23505';
  END IF;
  IF p_device_token_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND device_token_hash = p_device_token_hash AND status <> 'deleted') THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_device', 85);
    RAISE EXCEPTION 'A vote from this device was already recorded' USING ERRCODE='23505';
  END IF;

  -- Home country / IP country mismatch is suspicious (not blocked)
  IF p_ip_country IS NOT NULL AND p_ip_country <> '' AND upper(p_ip_country) <> upper(p_country_code) THEN
    v_risk := v_risk + 15;
  END IF;
  IF p_is_vpn THEN
    v_risk := v_risk + 40;
  END IF;

  INSERT INTO vote_submissions (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, ip_country, is_vpn, risk_score, status)
    VALUES (p_round_id, trim(p_username), v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, p_ip_country, COALESCE(p_is_vpn, false), v_risk, CASE WHEN v_risk >= 50 THEN 'suspicious' ELSE 'active' END)
    RETURNING id INTO v_sub_id;

  INSERT INTO vote_entries (submission_id, target_country_code, points)
    SELECT v_sub_id, e->>'target_country_code', (e->>'points')::int
    FROM jsonb_array_elements(p_entries) e;

  IF v_risk >= 50 THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score, metadata, status)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash,
              CASE WHEN p_is_vpn THEN 'vpn_or_proxy' ELSE 'country_mismatch' END,
              v_risk,
              jsonb_build_object('ip_country', p_ip_country, 'home_country', p_country_code, 'is_vpn', p_is_vpn),
              'pending');
  END IF;

  RETURN jsonb_build_object('id', v_sub_id, 'risk_score', v_risk);
END;
$function$;
