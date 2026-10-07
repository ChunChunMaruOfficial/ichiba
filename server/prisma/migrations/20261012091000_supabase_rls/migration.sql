-- Row Level Security for Supabase.
--
-- Supabase publishes every table of the "public" schema through its REST API (PostgREST), reachable with the
-- publishable key that is meant to be public. So every table gets RLS: with no policy a table is closed to the
-- anon/authenticated roles. The API connects as the table owner (postgres) and is not affected; it keeps doing all
-- writes and enforces ownership itself.
--
-- The only things opened are what the public site shows anyway: visible listings and their photos. Writes through
-- the REST API are allowed only on one's own listings and photos (auth.uid() = owner), so even a valid user token
-- can't touch someone else's listing.
--
-- On a plain Postgres (local `prisma dev`) the Supabase roles and auth schema don't exist: only RLS is enabled.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    RAISE NOTICE 'Not a Supabase database: RLS enabled, policies skipped';
    RETURN;
  END IF;

  -- Listings: everyone sees live and sold items; owners see all of theirs and may change only theirs.
  EXECUTE $p$CREATE POLICY listing_public_read ON public."Listing" FOR SELECT TO anon, authenticated
    USING (status IN ('PUBLISHED', 'RESERVED', 'SOLD'))$p$;
  EXECUTE $p$CREATE POLICY listing_owner_read ON public."Listing" FOR SELECT TO authenticated
    USING ("sellerId" = (SELECT auth.uid())::text)$p$;
  EXECUTE $p$CREATE POLICY listing_owner_insert ON public."Listing" FOR INSERT TO authenticated
    WITH CHECK ("sellerId" = (SELECT auth.uid())::text)$p$;
  EXECUTE $p$CREATE POLICY listing_owner_update ON public."Listing" FOR UPDATE TO authenticated
    USING ("sellerId" = (SELECT auth.uid())::text) WITH CHECK ("sellerId" = (SELECT auth.uid())::text)$p$;
  EXECUTE $p$CREATE POLICY listing_owner_delete ON public."Listing" FOR DELETE TO authenticated
    USING ("sellerId" = (SELECT auth.uid())::text)$p$;

  -- Photos (metadata and Cloudinary URLs only, the files are in Cloudinary): visible with their listing.
  EXECUTE $p$CREATE POLICY photo_public_read ON public."Photo" FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM public."Listing" l WHERE l.id = "listingId" AND l.status IN ('PUBLISHED', 'RESERVED', 'SOLD')))$p$;
  EXECUTE $p$CREATE POLICY photo_owner_all ON public."Photo" FOR ALL TO authenticated
    USING ("ownerId" = (SELECT auth.uid())::text) WITH CHECK ("ownerId" = (SELECT auth.uid())::text)$p$;

  -- Direct table access is limited to these two tables; everything else stays closed even if RLS were turned off.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'GRANT SELECT ON public."Listing", public."Photo" TO anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public."Listing", public."Photo" TO authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
END $$;

-- Tables added by later migrations get RLS automatically, so a new table is never public by mistake.
CREATE OR REPLACE FUNCTION public.ichiba_enable_rls() RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public' LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END $$;

DO $$
BEGIN
  DROP EVENT TRIGGER IF EXISTS ichiba_enable_rls;
  CREATE EVENT TRIGGER ichiba_enable_rls ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.ichiba_enable_rls();
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'No permission for event triggers: enable RLS on new tables in their migrations';
END $$;
