
CREATE TABLE public.televote_aggregations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id uuid REFERENCES public.editions(id) ON DELETE SET NULL,
  name text NOT NULL,
  combination_method text NOT NULL DEFAULT 'raw',
  total_points_to_distribute integer NOT NULL DEFAULT 0,
  rank_exponent numeric NOT NULL DEFAULT 1.33,
  status text NOT NULL DEFAULT 'draft',
  calculation_version integer NOT NULL DEFAULT 0,
  calculated_at timestamptz,
  calculated_by uuid,
  calculated_by_username text,
  locked_at timestamptz,
  published_at timestamptz,
  results_outdated boolean NOT NULL DEFAULT false,
  public_columns jsonb NOT NULL DEFAULT '{"sources":false,"combined_original":false,"converted":true,"bonus":true,"final":true}'::jsonb,
  broadcast_display_mode text NOT NULL DEFAULT 'final',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.televote_aggregations TO anon, authenticated;
GRANT ALL ON public.televote_aggregations TO service_role;
ALTER TABLE public.televote_aggregations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published aggregations" ON public.televote_aggregations
  FOR SELECT USING (status = 'published');

CREATE TABLE public.televote_aggregation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_id uuid NOT NULL REFERENCES public.televote_aggregations(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregation_id, country_code)
);
GRANT SELECT ON public.televote_aggregation_participants TO anon, authenticated;
GRANT ALL ON public.televote_aggregation_participants TO service_role;
ALTER TABLE public.televote_aggregation_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published aggregation participants" ON public.televote_aggregation_participants
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.televote_aggregations a WHERE a.id = aggregation_id AND a.status = 'published'));

CREATE TABLE public.televote_aggregation_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_id uuid NOT NULL REFERENCES public.televote_aggregations(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'round',
  source_round_id uuid REFERENCES public.rounds(id) ON DELETE SET NULL,
  source_name text NOT NULL,
  calculation_stage text NOT NULL DEFAULT 'pre_conversion',
  weight numeric NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.televote_aggregation_sources TO service_role;
ALTER TABLE public.televote_aggregation_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.external_score_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.televote_aggregation_sources(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  value numeric NOT NULL DEFAULT 0,
  entry_type text NOT NULL DEFAULT 'other',
  reason text,
  entered_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, country_code)
);
GRANT ALL ON public.external_score_entries TO service_role;
ALTER TABLE public.external_score_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.external_score_entry_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid,
  aggregation_id uuid,
  country_code text,
  previous_value numeric,
  new_value numeric,
  delta numeric,
  entry_type text,
  reason text,
  actor_username text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.external_score_entry_log TO service_role;
ALTER TABLE public.external_score_entry_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.combined_televote_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregation_id uuid NOT NULL REFERENCES public.televote_aggregations(id) ON DELETE CASCADE,
  country_code text NOT NULL REFERENCES public.countries(code),
  source_contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  pre_conversion_total numeric NOT NULL DEFAULT 0,
  manual_pre_conversion_adjustment numeric NOT NULL DEFAULT 0,
  combined_original_score numeric NOT NULL DEFAULT 0,
  combined_original_rank integer NOT NULL DEFAULT 0,
  participant_count integer NOT NULL DEFAULT 0,
  rank_base integer NOT NULL DEFAULT 0,
  rank_exponent numeric NOT NULL DEFAULT 1.33,
  rank_factor numeric NOT NULL DEFAULT 0,
  weighted_score numeric NOT NULL DEFAULT 0,
  exact_converted_points numeric NOT NULL DEFAULT 0,
  floored_points integer NOT NULL DEFAULT 0,
  decimal_remainder numeric NOT NULL DEFAULT 0,
  remainder_bonus integer NOT NULL DEFAULT 0,
  converted_points integer NOT NULL DEFAULT 0,
  post_conversion_bonus numeric NOT NULL DEFAULT 0,
  post_conversion_adjustment numeric NOT NULL DEFAULT 0,
  final_televote_score numeric NOT NULL DEFAULT 0,
  calculation_version integer NOT NULL DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregation_id, country_code)
);
GRANT SELECT ON public.combined_televote_results TO anon, authenticated;
GRANT ALL ON public.combined_televote_results TO service_role;
ALTER TABLE public.combined_televote_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read published combined results" ON public.combined_televote_results
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.televote_aggregations a WHERE a.id = aggregation_id AND a.status = 'published'));

CREATE TRIGGER trg_televote_aggregations_updated BEFORE UPDATE ON public.televote_aggregations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_televote_aggregation_sources_updated BEFORE UPDATE ON public.televote_aggregation_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_external_score_entries_updated BEFORE UPDATE ON public.external_score_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_combined_televote_results_updated BEFORE UPDATE ON public.combined_televote_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.flag_aggregation_outdated()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
DECLARE v_agg uuid;
BEGIN
  IF TG_TABLE_NAME = 'external_score_entries' THEN
    SELECT s.aggregation_id INTO v_agg FROM public.televote_aggregation_sources s
      WHERE s.id = COALESCE(NEW.source_id, OLD.source_id);
  ELSE
    v_agg := COALESCE(NEW.aggregation_id, OLD.aggregation_id);
  END IF;
  UPDATE public.televote_aggregations SET results_outdated = true
    WHERE id = v_agg AND calculation_version > 0;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_sources_outdated AFTER INSERT OR UPDATE OR DELETE ON public.televote_aggregation_sources
  FOR EACH ROW EXECUTE FUNCTION public.flag_aggregation_outdated();
CREATE TRIGGER trg_entries_outdated AFTER INSERT OR UPDATE OR DELETE ON public.external_score_entries
  FOR EACH ROW EXECUTE FUNCTION public.flag_aggregation_outdated();
CREATE TRIGGER trg_participants_outdated AFTER INSERT OR UPDATE OR DELETE ON public.televote_aggregation_participants
  FOR EACH ROW EXECUTE FUNCTION public.flag_aggregation_outdated();
