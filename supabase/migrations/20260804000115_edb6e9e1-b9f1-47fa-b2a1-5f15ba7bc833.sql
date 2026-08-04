-- 1. Ballot deletion metadata
ALTER TABLE public.vote_submissions
  ADD COLUMN IF NOT EXISTS deletion_category text,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE INDEX IF NOT EXISTS idx_vote_submissions_round_status ON public.vote_submissions (round_id, status);
CREATE INDEX IF NOT EXISTS idx_vote_submissions_country ON public.vote_submissions (country_code);
CREATE INDEX IF NOT EXISTS idx_vote_submissions_created ON public.vote_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vote_submissions_delcat ON public.vote_submissions (deletion_category);
CREATE INDEX IF NOT EXISTS idx_vote_entries_target ON public.vote_entries (target_country_code);
CREATE INDEX IF NOT EXISTS idx_vote_entries_submission ON public.vote_entries (submission_id);

-- 2. Immutable moderation event log
CREATE TABLE IF NOT EXISTS public.vote_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_submission_id uuid REFERENCES public.vote_submissions(id) ON DELETE SET NULL,
  voting_country_code text,
  target_country_code text,
  action text NOT NULL,
  previous_status text,
  new_status text,
  reason_category text,
  moderator_note text,
  performed_by uuid,
  performed_by_username text,
  performed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.vote_moderation_events TO service_role;
ALTER TABLE public.vote_moderation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access to moderation events"
  ON public.vote_moderation_events FOR SELECT TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS idx_vme_submission ON public.vote_moderation_events (vote_submission_id);
CREATE INDEX IF NOT EXISTS idx_vme_pair ON public.vote_moderation_events (voting_country_code, target_country_code);
CREATE INDEX IF NOT EXISTS idx_vme_time ON public.vote_moderation_events (performed_at DESC);

CREATE OR REPLACE FUNCTION public.protect_moderation_events()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN RAISE EXCEPTION 'Moderation history cannot be modified'; END; $$;
DROP TRIGGER IF EXISTS vme_no_update ON public.vote_moderation_events;
CREATE TRIGGER vme_no_update BEFORE UPDATE OR DELETE ON public.vote_moderation_events
  FOR EACH ROW EXECUTE FUNCTION public.protect_moderation_events();

-- 3. Detection settings (single row)
CREATE TABLE IF NOT EXISTS public.friend_voting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.friend_voting_settings TO service_role;
ALTER TABLE public.friend_voting_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access to detection settings"
  ON public.friend_voting_settings FOR SELECT TO authenticated USING (false);
DROP TRIGGER IF EXISTS fvs_updated_at ON public.friend_voting_settings;
CREATE TRIGGER fvs_updated_at BEFORE UPDATE ON public.friend_voting_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.friend_voting_settings (singleton, settings)
VALUES (true, '{}'::jsonb)
ON CONFLICT (singleton) DO NOTHING;

-- 4. Stored relationship analysis
CREATE TABLE IF NOT EXISTS public.friend_voting_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voting_country_code text NOT NULL,
  target_country_code text NOT NULL,
  shared_opportunities integer NOT NULL DEFAULT 0,
  active_opportunities integer NOT NULL DEFAULT 0,
  deleted_opportunities integer NOT NULL DEFAULT 0,
  support_count integer NOT NULL DEFAULT 0,
  top_three_count integer NOT NULL DEFAULT 0,
  maximum_score_count integer NOT NULL DEFAULT 0,
  active_maximum_score_count integer NOT NULL DEFAULT 0,
  deleted_maximum_score_count integer NOT NULL DEFAULT 0,
  second_score_count integer NOT NULL DEFAULT 0,
  total_points numeric NOT NULL DEFAULT 0,
  active_points numeric NOT NULL DEFAULT 0,
  deleted_points numeric NOT NULL DEFAULT 0,
  average_points numeric NOT NULL DEFAULT 0,
  average_points_supported numeric NOT NULL DEFAULT 0,
  average_ballot_rank numeric,
  support_frequency numeric NOT NULL DEFAULT 0,
  top_three_frequency numeric NOT NULL DEFAULT 0,
  maximum_score_frequency numeric NOT NULL DEFAULT 0,
  preference_lift numeric NOT NULL DEFAULT 0,
  top_score_concentration numeric NOT NULL DEFAULT 0,
  audience_uplift numeric NOT NULL DEFAULT 0,
  normalized_audience_uplift numeric NOT NULL DEFAULT 0,
  longest_support_streak integer NOT NULL DEFAULT 0,
  current_support_streak integer NOT NULL DEFAULT 0,
  editions_count integer NOT NULL DEFAULT 0,
  rounds_count integer NOT NULL DEFAULT 0,
  first_support_at timestamptz,
  last_support_at timestamptz,
  last_maximum_at timestamptz,
  reciprocity_score numeric NOT NULL DEFAULT 0,
  clique_score numeric NOT NULL DEFAULT 0,
  previous_friend_vote_deletions integer NOT NULL DEFAULT 0,
  previous_coordination_deletions integer NOT NULL DEFAULT 0,
  previous_duplicate_deletions integer NOT NULL DEFAULT 0,
  repeated_after_moderation boolean NOT NULL DEFAULT false,
  risk_score integer NOT NULL DEFAULT 0,
  risk_label text NOT NULL DEFAULT 'Normal voting pattern',
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_version integer NOT NULL DEFAULT 1,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  review_status text NOT NULL DEFAULT 'new',
  reviewed_by uuid,
  reviewed_at timestamptz,
  moderator_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voting_country_code, target_country_code)
);
GRANT ALL ON public.friend_voting_relationships TO service_role;
ALTER TABLE public.friend_voting_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access to relationship analysis"
  ON public.friend_voting_relationships FOR SELECT TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS idx_fvr_risk ON public.friend_voting_relationships (risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_fvr_voting ON public.friend_voting_relationships (voting_country_code);
CREATE INDEX IF NOT EXISTS idx_fvr_target ON public.friend_voting_relationships (target_country_code);
CREATE INDEX IF NOT EXISTS idx_fvr_review ON public.friend_voting_relationships (review_status);
DROP TRIGGER IF EXISTS fvr_updated_at ON public.friend_voting_relationships;
CREATE TRIGGER fvr_updated_at BEFORE UPDATE ON public.friend_voting_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Friend groups
CREATE TABLE IF NOT EXISTS public.friend_voting_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  members text[] NOT NULL DEFAULT '{}',
  internal_point_share numeric NOT NULL DEFAULT 0,
  internal_top_three_share numeric NOT NULL DEFAULT 0,
  internal_maximum_share numeric NOT NULL DEFAULT 0,
  group_reciprocity numeric NOT NULL DEFAULT 0,
  editions_observed integer NOT NULL DEFAULT 0,
  rounds_observed integer NOT NULL DEFAULT 0,
  strong_internal_edges integer NOT NULL DEFAULT 0,
  average_internal_support numeric NOT NULL DEFAULT 0,
  average_external_support numeric NOT NULL DEFAULT 0,
  deleted_internal_ballots integer NOT NULL DEFAULT 0,
  repeated_after_moderation integer NOT NULL DEFAULT 0,
  risk_score integer NOT NULL DEFAULT 0,
  risk_label text NOT NULL DEFAULT 'Normal voting pattern',
  edges jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_version integer NOT NULL DEFAULT 1,
  review_status text NOT NULL DEFAULT 'new',
  moderator_note text,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.friend_voting_groups TO service_role;
ALTER TABLE public.friend_voting_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access to friend groups"
  ON public.friend_voting_groups FOR SELECT TO authenticated USING (false);
CREATE INDEX IF NOT EXISTS idx_fvg_risk ON public.friend_voting_groups (risk_score DESC);
DROP TRIGGER IF EXISTS fvg_updated_at ON public.friend_voting_groups;
CREATE TRIGGER fvg_updated_at BEFORE UPDATE ON public.friend_voting_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();