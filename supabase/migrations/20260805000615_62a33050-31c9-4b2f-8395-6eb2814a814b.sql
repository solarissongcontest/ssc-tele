-- 1. Sources: component-pool model
ALTER TABLE public.televote_aggregation_sources
  ADD COLUMN IF NOT EXISTS percentage_weight numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculation_method text NOT NULL DEFAULT 'rank_weighted',
  ADD COLUMN IF NOT EXISTS exact_point_pool numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS floored_point_pool integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pool_remainder numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pool_remainder_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_point_pool integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correction_target_source_id uuid REFERENCES public.televote_aggregation_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_scope text NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS tie_break_data jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.televote_aggregation_sources
   SET percentage_weight = GREATEST(0, COALESCE(weight, 0))
 WHERE percentage_weight = 0;

UPDATE public.televote_aggregation_sources
   SET calculation_method = CASE
     WHEN source_type = 'activity' THEN 'proportional'
     WHEN source_type = 'correction' THEN 'adjustment'
     ELSE 'rank_weighted' END;

-- 2. Final combined results: per-version history + component totals
ALTER TABLE public.combined_televote_results
  ADD COLUMN IF NOT EXISTS total_voting_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_activity_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_combined_points numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_correction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_rank integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_tie_break_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS component_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.combined_televote_results
  DROP CONSTRAINT IF EXISTS combined_televote_results_aggregation_id_country_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS combined_results_agg_country_version_key
  ON public.combined_televote_results (aggregation_id, country_code, calculation_version);

-- 3. Per-source component results
CREATE TABLE IF NOT EXISTS public.combined_televote_component_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_id uuid NOT NULL REFERENCES public.televote_aggregations(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES public.televote_aggregation_sources(id) ON DELETE CASCADE,
  component_name text NOT NULL DEFAULT '',
  component_type text NOT NULL DEFAULT 'round',
  country_code text NOT NULL REFERENCES public.countries(code),
  calculation_version integer NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'rank_weighted',
  percentage_weight numeric NOT NULL DEFAULT 0,
  component_pool integer NOT NULL DEFAULT 0,
  raw_score numeric NOT NULL DEFAULT 0,
  raw_rank integer,
  participant_count integer NOT NULL DEFAULT 0,
  rank_base integer,
  rank_exponent numeric,
  rank_factor numeric,
  weighted_score numeric,
  source_weighted_total numeric,
  exact_allocation numeric NOT NULL DEFAULT 0,
  floored_allocation integer NOT NULL DEFAULT 0,
  decimal_remainder numeric NOT NULL DEFAULT 0,
  remainder_bonus integer NOT NULL DEFAULT 0,
  final_allocated_points integer NOT NULL DEFAULT 0,
  tie_break_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregation_id, component_id, country_code, calculation_version)
);
GRANT SELECT ON public.combined_televote_component_results TO anon, authenticated;
GRANT ALL ON public.combined_televote_component_results TO service_role;
ALTER TABLE public.combined_televote_component_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published component results"
  ON public.combined_televote_component_results
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.televote_aggregations a
     WHERE a.id = aggregation_id AND a.status = 'published'));

CREATE INDEX IF NOT EXISTS combined_component_results_lookup
  ON public.combined_televote_component_results (aggregation_id, calculation_version);

-- Editing component results must mark the aggregation outdated like other inputs
CREATE TRIGGER trg_component_results_outdated
  AFTER INSERT OR UPDATE OR DELETE ON public.combined_televote_component_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_component_results_outdated ON public.combined_televote_component_results;