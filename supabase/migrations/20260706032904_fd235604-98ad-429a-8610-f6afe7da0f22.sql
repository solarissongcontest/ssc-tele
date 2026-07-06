ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.round_countries;
ALTER TABLE public.rounds REPLICA IDENTITY FULL;
ALTER TABLE public.round_countries REPLICA IDENTITY FULL;
ALTER TABLE public.vote_submissions REPLICA IDENTITY FULL;