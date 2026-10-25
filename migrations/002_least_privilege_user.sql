-- 002_least_privilege_user.sql: Setup Least-Privilege Database Role for AVOS

-- 1. Create dedicated application role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'avos_app_user') THEN
    CREATE ROLE avos_app_user WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION_VAULT';
  END IF;
END
$$;

-- 2. Restrict database access
REVOKE ALL ON DATABASE avos_db FROM PUBLIC;
GRANT CONNECT ON DATABASE avos_db TO avos_app_user;

-- 3. Grant schema usage and DML privileges (NO DDL, NO DROP TABLE, NO SUPERUSER)
GRANT USAGE ON SCHEMA public TO avos_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avos_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO avos_app_user;

-- 4. Ensure future tables also inherit strict DML privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avos_app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
GRANT USAGE, SELECT ON SEQUENCES TO avos_app_user;
