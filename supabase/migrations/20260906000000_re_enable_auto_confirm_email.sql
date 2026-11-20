-- ====================================================================
-- RE-ENABLE AUTO-CONFIRM EMAIL TRIGGER
-- ====================================================================
-- Problem: The previous migration (disable_auto_confirm_enable_brevo)
-- dropped the auto-confirm trigger, expecting Brevo SMTP to handle
-- email confirmation. However, Brevo SMTP is only configured for
-- custom email notifications (welcome emails, etc.), NOT for
-- Supabase Auth's built-in confirmation emails.
--
-- This means new signups have no way to confirm their email:
--   ✗ Auto-confirm trigger → DROPPED
--   ✗ Brevo SMTP for Auth → NOT configured
--   ✗ User receives no confirmation email
--
-- Fix: Re-enable the auto-confirm trigger so users can sign up
-- and log in immediately without email verification.
-- The Brevo welcome email (sent via admin-data edge function) will
-- still be sent for onboarding purposes.
-- ====================================================================

-- Confirm all existing unverified users
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    updated_at = NOW()
WHERE email_confirmed_at IS NULL;

-- Re-create the auto-confirm function
CREATE OR REPLACE FUNCTION auto_confirm_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Auto-confirm the email for new signups
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      updated_at = NOW()
  WHERE id = NEW.id
    AND email_confirmed_at IS NULL;
  RETURN NEW;
END;
$$;

-- Re-attach trigger to auth.users (fires after INSERT)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auto_confirm_email();

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
