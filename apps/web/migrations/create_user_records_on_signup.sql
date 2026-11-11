-- Migration: create_user_records_on_signup
-- When a new row is inserted into public.users, automatically create:
--   1. A user_balances row (available_balance = 0)
--   2. A user_stats row (all stats null, ready to be populated)
--
-- This fires AFTER the existing auth.users → public.users trigger,
-- so public.users(id) is already committed when this runs.

CREATE OR REPLACE FUNCTION public.handle_new_public_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create balance record (starts at 0)
  INSERT INTO public.user_balances (user_id, available_balance)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Create stats record (nulls = no activity yet)
  INSERT INTO public.user_stats (user_id, jobs_done, total_revenue)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT DO NOTHING;

  -- Generate and assign referrer code if not already set
  IF NEW.referrer_code IS NULL THEN
    UPDATE public.users
    SET referrer_code = generate_artistic_code()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop trigger if it already exists (idempotent)
DROP TRIGGER IF EXISTS on_public_user_created ON public.users;

CREATE TRIGGER on_public_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_public_user();
