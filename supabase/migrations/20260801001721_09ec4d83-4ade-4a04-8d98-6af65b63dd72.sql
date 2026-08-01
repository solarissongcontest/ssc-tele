
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS total_points_to_distribute integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rank_exponent numeric NOT NULL DEFAULT 1.33,
  ADD COLUMN IF NOT EXISTS results_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS calculation_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS calculated_by uuid,
  ADD COLUMN IF NOT EXISTS calculated_by_username text,
  ADD COLUMN IF NOT EXISTS calc_participant_codes text[],
  ADD COLUMN IF NOT EXISTS results_outdated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_advanced_transparency boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS broadcast_display_mode text NOT NULL DEFAULT 'converted';

DO $$ BEGIN
  ALTER TABLE public.rounds ADD CONSTRAINT rounds_results_status_check
    CHECK (results_status IN ('draft','calculated','locked','published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.rounds ADD CONSTRAINT rounds_total_points_check
    CHECK (total_points_to_distribute >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.rounds ADD CONSTRAINT rounds_broadcast_mode_check
    CHECK (broadcast_display_mode IN ('original','converted','combined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.round_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  original_votes integer NOT NULL DEFAULT 0,
  original_voters integer NOT NULL DEFAULT 0,
  original_rank integer NOT NULL,
  participant_count integer NOT NULL,
  rank_base integer NOT NULL,
  rank_exponent numeric NOT NULL,
  rank_factor numeric NOT NULL,
  weighted_score numeric NOT NULL,
  exact_points numeric NOT NULL,
  floored_points integer NOT NULL,
  decimal_remainder numeric NOT NULL,
  remainder_bonus integer NOT NULL DEFAULT 0,
  final_points integer NOT NULL,
  total_points_to_distribute integer NOT NULL,
  calculation_version integer NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, country_code)
);

GRANT SELECT ON public.round_results TO anon, authenticated;
GRANT ALL ON public.round_results TO service_role;

ALTER TABLE public.round_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published round results" ON public.round_results;
CREATE POLICY "Public read published round results"
ON public.round_results FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.rounds r
  WHERE r.id = round_results.round_id AND r.results_status = 'published'
));

DROP POLICY IF EXISTS "Admins manage round_results" ON public.round_results;
CREATE POLICY "Admins manage round_results"
ON public.round_results FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS round_results_round_idx ON public.round_results(round_id);

DROP TRIGGER IF EXISTS round_results_updated_at ON public.round_results;
CREATE TRIGGER round_results_updated_at BEFORE UPDATE ON public.round_results
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lineup changes invalidate any existing calculation (n + 2 changes)
CREATE OR REPLACE FUNCTION public.flag_round_results_outdated()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_round uuid;
BEGIN
  v_round := COALESCE(NEW.round_id, OLD.round_id);
  UPDATE public.rounds
     SET results_outdated = true
   WHERE id = v_round AND calculation_version > 0;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS round_countries_flag_outdated ON public.round_countries;
CREATE TRIGGER round_countries_flag_outdated
AFTER INSERT OR UPDATE OR DELETE ON public.round_countries
FOR EACH ROW EXECUTE FUNCTION public.flag_round_results_outdated();
