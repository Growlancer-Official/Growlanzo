-- ═══════════════════════════════════════════════════════════════════════════
-- Referral codes occasionally came out as GRW-4MNV-B9G instead of
-- GRW-XXXX-XXXX.
--
-- `v_alphabet` deliberately has 30 characters (no 0/O, 1/I/L, U), but the
-- generator indexed it with `v_byte % 32`. Whenever the byte was 240–255 the
-- index was 30 or 31, `substr` returned empty, and the code lost a character.
-- Measured live on 20 regenerated test codes: 3 had a 3-character segment.
--
-- Use the actual alphabet length. The modulo bias (256 % 30) is irrelevant for
-- a human-shared, collision-checked referral code.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  -- No 0/O, 1/I/L, U — characters people mistype reading a code off a screen.
  v_alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_alphabet_len CONSTANT integer := length('23456789ABCDEFGHJKMNPQRSTVWXYZ');
  v_hex text;
  v_byte integer;
  v_code text;
  v_attempt integer := 0;
BEGIN
  WHILE v_attempt < 25 LOOP
    v_attempt := v_attempt + 1;

    v_hex := md5(
      random()::text || clock_timestamp()::text || coalesce(txid_current()::text, '') || v_attempt::text
    );
    v_code := 'GRW-';

    FOR i IN 0..7 LOOP
      v_byte := ('x' || substr(v_hex, i * 2 + 1, 2))::bit(8)::integer;
      v_code := v_code || substr(v_alphabet, (v_byte % v_alphabet_len) + 1, 1);
      IF i = 3 THEN
        v_code := v_code || '-';
      END IF;
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles_private pp WHERE pp.referral_code = v_code
    );
  END LOOP;

  IF v_attempt >= 25 AND EXISTS (
    SELECT 1 FROM public.profiles_private pp WHERE pp.referral_code = v_code
  ) THEN
    RAISE EXCEPTION 'generate_referral_code: could not find a free code after 25 attempts';
  END IF;

  RETURN v_code;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
