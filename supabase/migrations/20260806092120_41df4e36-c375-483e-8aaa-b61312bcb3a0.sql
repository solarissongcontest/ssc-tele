-- ============ 1. Generic round entries ============
CREATE TABLE IF NOT EXISTS public.round_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  entry_type text NOT NULL DEFAULT 'country' CHECK (entry_type IN ('country','custom')),
  entry_key text NOT NULL,
  country_code text,
  custom_name text,
  short_name text,
  entry_code text,
  subtitle text,
  image_url text,
  description text,
  display_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT round_entries_identity_chk CHECK (
    (entry_type = 'country' AND country_code IS NOT NULL AND custom_name IS NULL)
    OR (entry_type = 'custom' AND custom_name IS NOT NULL AND country_code IS NULL)
  ),
  CONSTRAINT round_entries_unique_key UNIQUE (round_id, entry_key)
);

GRANT SELECT ON public.round_entries TO anon;
GRANT SELECT ON public.round_entries TO authenticated;
GRANT ALL ON public.round_entries TO service_role;

ALTER TABLE public.round_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Round entries are publicly readable" ON public.round_entries;
CREATE POLICY "Round entries are publicly readable"
  ON public.round_entries FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS round_entries_round_idx ON public.round_entries(round_id, display_order);

-- entry_key is derived, never free-form for country entries
CREATE OR REPLACE FUNCTION public.round_entries_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.entry_type = 'country' THEN
    NEW.entry_key := NEW.country_code;
  ELSE
    IF NEW.entry_key IS NULL OR NEW.entry_key = '' OR NEW.entry_key = OLD.entry_key IS NOT TRUE THEN
      NEW.entry_key := COALESCE(NULLIF(NEW.entry_key,''), 'x_' || encode(gen_random_bytes(6),'hex'));
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS round_entries_normalize_trg ON public.round_entries;
CREATE TRIGGER round_entries_normalize_trg
  BEFORE INSERT OR UPDATE ON public.round_entries
  FOR EACH ROW EXECUTE FUNCTION public.round_entries_normalize();

-- Keep the legacy round_countries mirror in sync for country entries
CREATE OR REPLACE FUNCTION public.round_entries_sync_countries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_type = 'country' THEN
      DELETE FROM public.round_countries
        WHERE round_id = OLD.round_id AND country_code = OLD.country_code;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.entry_type = 'country'
     AND (NEW.entry_type <> 'country' OR NEW.country_code <> OLD.country_code) THEN
    DELETE FROM public.round_countries
      WHERE round_id = OLD.round_id AND country_code = OLD.country_code;
  END IF;

  IF NEW.entry_type = 'country' THEN
    INSERT INTO public.round_countries (round_id, country_code, display_order)
      VALUES (NEW.round_id, NEW.country_code, NEW.display_order)
      ON CONFLICT (round_id, country_code)
      DO UPDATE SET display_order = EXCLUDED.display_order;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS round_entries_sync_countries_trg ON public.round_entries;
CREATE TRIGGER round_entries_sync_countries_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.round_entries
  FOR EACH ROW EXECUTE FUNCTION public.round_entries_sync_countries();

DROP TRIGGER IF EXISTS round_entries_flag_outdated ON public.round_entries;
CREATE TRIGGER round_entries_flag_outdated
  AFTER INSERT OR UPDATE OR DELETE ON public.round_entries
  FOR EACH ROW EXECUTE FUNCTION public.flag_round_results_outdated();

-- ============ 2. Backfill existing country line-ups ============
INSERT INTO public.round_entries (round_id, entry_type, entry_key, country_code, display_order)
SELECT rc.round_id, 'country', rc.country_code, rc.country_code, rc.display_order
FROM public.round_countries rc
ON CONFLICT (round_id, entry_key) DO NOTHING;

-- ============ 3. Round settings ============
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS participant_mode text NOT NULL DEFAULT 'countries'
    CHECK (participant_mode IN ('countries','custom','mixed')),
  ADD COLUMN IF NOT EXISTS self_voting_mode text NOT NULL DEFAULT 'country_match'
    CHECK (self_voting_mode IN ('country_match','linked_identity','disabled','unrestricted'));

-- ============ 4. Combined televote source input mode ============
ALTER TABLE public.televote_aggregation_sources
  ADD COLUMN IF NOT EXISTS input_mode text NOT NULL DEFAULT 'raw_results'
    CHECK (input_mode IN ('raw_results','converted_points','activity_points','correction'));

UPDATE public.televote_aggregation_sources
   SET input_mode = CASE
     WHEN source_type = 'activity' THEN 'activity_points'
     WHEN source_type = 'correction' THEN 'correction'
     ELSE 'raw_results' END;

-- ============ 5. Allow non-country entry keys in result tables ============
ALTER TABLE public.round_results DROP CONSTRAINT IF EXISTS round_results_country_code_fkey;
ALTER TABLE public.televote_aggregation_participants DROP CONSTRAINT IF EXISTS televote_aggregation_participants_country_code_fkey;
ALTER TABLE public.combined_televote_results DROP CONSTRAINT IF EXISTS combined_televote_results_country_code_fkey;
ALTER TABLE public.combined_televote_component_results DROP CONSTRAINT IF EXISTS combined_televote_component_results_country_code_fkey;
ALTER TABLE public.external_score_entries DROP CONSTRAINT IF EXISTS external_score_entries_country_code_fkey;

-- ============ 6. submit_vote: generic entries + self-voting modes ============
CREATE OR REPLACE FUNCTION public.submit_vote(
  p_round_id uuid, p_username text, p_country_code text, p_entries jsonb,
  p_ip_hash text DEFAULT NULL, p_fingerprint_hash text DEFAULT NULL,
  p_device_token_hash text DEFAULT NULL, p_ip_country text DEFAULT NULL,
  p_is_vpn boolean DEFAULT false)
RETURNS jsonb
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
  v_round_keys text[];
  v_seen text[] := ARRAY[]::text[];
  v_sub_id uuid;
  v_count int;
  v_home_exists boolean;
  v_risk int := 0;
  v_self_key text;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 2 THEN
    RAISE EXCEPTION 'Username required' USING ERRCODE='22023';
  END IF;
  v_username_norm := lower(trim(p_username));

  SELECT * INTO v_round FROM rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Round not found' USING ERRCODE='22023'; END IF;
  IF v_round.status <> 'open' THEN RAISE EXCEPTION 'Round is not open' USING ERRCODE='22023'; END IF;

  SELECT array_agg(entry_key) INTO v_round_keys FROM round_entries WHERE round_id = p_round_id;
  IF v_round_keys IS NULL OR array_length(v_round_keys,1) < 2 THEN
    RAISE EXCEPTION 'Round has no entries configured' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS(SELECT 1 FROM countries WHERE code = p_country_code) INTO v_home_exists;
  IF NOT v_home_exists THEN
    RAISE EXCEPTION 'Unknown home country' USING ERRCODE='22023';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Invalid entries payload' USING ERRCODE='22023';
  END IF;

  -- Which entry (if any) counts as "the voter's own" for this round
  IF COALESCE(v_round.self_voting_mode,'country_match') IN ('country_match','linked_identity','disabled') THEN
    SELECT entry_key INTO v_self_key FROM round_entries
      WHERE round_id = p_round_id AND entry_type = 'country' AND country_code = p_country_code;
  END IF;
  IF COALESCE(v_round.self_voting_mode,'country_match') = 'unrestricted' THEN
    v_self_key := NULL;
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_tc := v_entry->>'target_country_code';
    v_pts := (v_entry->>'points')::int;
    IF v_pts IS NULL OR v_pts < 1 OR v_pts > 10 THEN
      RAISE EXCEPTION 'Points must be 1-10' USING ERRCODE='22023';
    END IF;
    IF v_self_key IS NOT NULL AND v_tc = v_self_key THEN
      INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score, metadata)
        VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'self_vote', 80, jsonb_build_object('ip_country', p_ip_country, 'is_vpn', p_is_vpn));
      RAISE EXCEPTION 'Cannot vote for your own entry' USING ERRCODE='22023';
    END IF;
    IF NOT (v_tc = ANY(v_round_keys)) THEN
      RAISE EXCEPTION 'Entry is not part of this round' USING ERRCODE='22023';
    END IF;
    IF v_tc = ANY(v_seen) THEN
      RAISE EXCEPTION 'Duplicate entry in ballot' USING ERRCODE='22023';
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
    RAISE EXCEPTION 'Vote at least 5 different entries' USING ERRCODE='22023';
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