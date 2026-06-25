
CREATE OR REPLACE FUNCTION public.submit_vote(
  p_round_id uuid,
  p_username text,
  p_country_code text,
  p_entries jsonb,
  p_ip_hash text DEFAULT NULL,
  p_fingerprint_hash text DEFAULT NULL,
  p_device_token_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT (p_country_code = ANY(v_round_codes)) THEN
    RAISE EXCEPTION 'Home country not in this round' USING ERRCODE='22023';
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
      INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
        VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'self_vote', 80);
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

  IF EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND username_normalized = v_username_norm) THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_username', 90);
    RAISE EXCEPTION 'You have already voted in this round' USING ERRCODE='23505';
  END IF;
  IF p_ip_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND ip_hash = p_ip_hash) THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_ip', 70);
    RAISE EXCEPTION 'A vote from this network was already recorded' USING ERRCODE='23505';
  END IF;
  IF p_fingerprint_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND fingerprint_hash = p_fingerprint_hash) THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_fingerprint', 80);
    RAISE EXCEPTION 'A vote from this device was already recorded' USING ERRCODE='23505';
  END IF;
  IF p_device_token_hash IS NOT NULL AND EXISTS (SELECT 1 FROM vote_submissions WHERE round_id = p_round_id AND device_token_hash = p_device_token_hash) THEN
    INSERT INTO anti_abuse_events (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash, reason, risk_score)
      VALUES (p_round_id, p_username, v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash, 'duplicate_device', 85);
    RAISE EXCEPTION 'A vote from this device was already recorded' USING ERRCODE='23505';
  END IF;

  INSERT INTO vote_submissions (round_id, username, username_normalized, country_code, ip_hash, fingerprint_hash, device_token_hash)
    VALUES (p_round_id, trim(p_username), v_username_norm, p_country_code, p_ip_hash, p_fingerprint_hash, p_device_token_hash)
    RETURNING id INTO v_sub_id;

  INSERT INTO vote_entries (submission_id, target_country_code, points)
    SELECT v_sub_id, e->>'target_country_code', (e->>'points')::int
    FROM jsonb_array_elements(p_entries) e;

  RETURN jsonb_build_object('id', v_sub_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_vote(uuid,text,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_vote(uuid,text,text,jsonb,text,text,text) TO anon, authenticated;
