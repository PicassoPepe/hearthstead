-- Row-level security for tenant-scoped tables. Idempotent: safe to re-run after every migration.
-- The application connects as `deedwood_app` (NOT the table owner, NOT superuser), so these
-- policies apply. The request context is set per transaction with:
--   SELECT set_config('app.org_id', '<orgId>', true), set_config('app.user_id', '<userId>', true);
-- With no context set, current_setting(...) returns '' and every policy denies.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deedwood_app') THEN
    CREATE ROLE deedwood_app LOGIN PASSWORD 'deedwood_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO deedwood_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deedwood_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deedwood_app;
REVOKE ALL ON "_prisma_migrations" FROM deedwood_app;

CREATE OR REPLACE FUNCTION app_org_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.org_id', true), '') $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.user_id', true), '') $$;

-- Generic policy for every table that has an "organizationId" column.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'organizationId' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    IF t.table_name = 'Membership' THEN
      -- A user may always see their own memberships (needed for the org switcher).
      EXECUTE 'CREATE POLICY tenant_isolation ON "Membership" USING ("organizationId" = app_org_id() OR "userId" = app_user_id()) WITH CHECK ("organizationId" = app_org_id())';
    ELSIF t.table_name = 'EmailMessage' THEN
      EXECUTE 'CREATE POLICY tenant_isolation ON "EmailMessage" USING ("organizationId" = app_org_id()) WITH CHECK ("organizationId" IS NULL OR "organizationId" = app_org_id())';
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = app_org_id()) WITH CHECK ("organizationId" = app_org_id())', t.table_name);
    END IF;
  END LOOP;
END $$;

-- Organization rows: visible only to the current org.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Organization";
CREATE POLICY tenant_isolation ON "Organization" USING ("id" = app_org_id()) WITH CHECK ("id" = app_org_id());

-- Auth tables are global; the app role can only read users (writes go through the admin client).
REVOKE INSERT, UPDATE, DELETE ON "AuthAccount", "Session", "VerificationToken" FROM deedwood_app;

-- Platform-only tables: never reachable by the app role (written/read through the admin connection).
REVOKE ALL ON "SecurityEvent", "PlatformAdmin", "PlatformAuditLog", "Impersonation", "FeatureFlag", "PlatformAnnouncement", "Release", "Plan", "Subscription", "License", "Entitlement", "AccountToken", "BackupRun", "ErrorEvent", "PendingSignup", "StripeEvent" FROM deedwood_app;

-- Discount history is append-only for the app: it can add events but never change or remove them.
REVOKE UPDATE, DELETE ON "DiscountEvent" FROM deedwood_app;
