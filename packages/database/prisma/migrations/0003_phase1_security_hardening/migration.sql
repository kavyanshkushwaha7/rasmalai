-- This migration is intentionally unapplied by the security-fix task.
-- It narrows public profile columns and routes profile writes through a
-- SECURITY DEFINER function that derives the owner from auth.uid().

ALTER TABLE public.profiles
  ADD COLUMN avatar_path TEXT,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.rasmalai_set_profile_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.rasmalai_set_profile_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.rasmalai_set_profile_updated_at();

-- Public reads remain available, but only the validated server action may write.
DROP POLICY IF EXISTS profile_owner_insert ON public.profiles;
DROP POLICY IF EXISTS profile_owner_update ON public.profiles;
DROP POLICY IF EXISTS profile_avatars_public_read ON storage.objects;
DROP POLICY IF EXISTS profile_avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS profile_avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS profile_avatars_owner_delete ON storage.objects;

-- Do not expose server-managed timestamps or allow direct profile writes.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, nickname, avatar_url, avatar_path, games_played, wins)
  ON TABLE public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_profile(
  p_username TEXT,
  p_nickname TEXT,
  p_avatar_path TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user is required' USING ERRCODE = '42501';
  END IF;

  IF p_username IS NULL OR p_username !~ '^[a-z0-9_]{3,24}$' THEN
    RAISE EXCEPTION 'Invalid username' USING ERRCODE = '22023';
  END IF;

  IF p_nickname IS NULL OR length(p_nickname) NOT BETWEEN 2 AND 40 OR p_nickname <> btrim(p_nickname) THEN
    RAISE EXCEPTION 'Invalid nickname' USING ERRCODE = '22023';
  END IF;

  IF p_avatar_path IS NOT NULL THEN
    IF p_avatar_path !~ ('^' || v_user_id::TEXT || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$') THEN
      RAISE EXCEPTION 'Avatar path is not owned by the authenticated user' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object
      WHERE object.bucket_id = 'profile-avatars'
        AND object.name = p_avatar_path
        AND (storage.foldername(object.name))[1] = v_user_id::TEXT
    ) THEN
      RAISE EXCEPTION 'Avatar object does not exist in the authenticated user folder' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, username, nickname, avatar_path)
  VALUES (v_user_id, p_username, p_nickname, p_avatar_path)
  ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username,
        nickname = EXCLUDED.nickname,
        avatar_path = COALESCE(p_avatar_path, public.profiles.avatar_path);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_profile(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_profile(TEXT, TEXT, TEXT) TO authenticated;
