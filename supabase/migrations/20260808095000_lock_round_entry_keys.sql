-- Lock generic round entry identity after creation.
--
-- Country entries always use their country code as entry_key.
-- Custom entries receive a generated key on insert when none was supplied.
-- On update, custom entry_key is forced back to OLD.entry_key so renaming or
-- editing presentation fields can never silently change ballot/result identity.

CREATE OR REPLACE FUNCTION public.round_entries_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.entry_type = 'country' THEN
    NEW.entry_key := NEW.country_code;
  ELSE
    IF TG_OP = 'INSERT' THEN
      NEW.entry_key := COALESCE(
        NULLIF(btrim(NEW.entry_key), ''),
        'x_' || encode(gen_random_bytes(6), 'hex')
      );
    ELSE
      NEW.entry_key := OLD.entry_key;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
