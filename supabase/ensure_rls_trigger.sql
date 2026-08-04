-- The RLS auto-enable safety net. This event trigger has been live since
-- 2026-06-25 but was never version-controlled; committed 2026-08-04 so a
-- rebuild-from-source reproduces it. Without this trigger, any new public table
-- ships with RLS OFF unless someone remembers to enable it manually — the exact
-- "new table is silently world-readable" failure this exists to prevent.
--
-- NOTE: enabling RLS is NOT the same as adding policies. This trigger only turns
-- RLS on (deny-all by default); every new user-data table STILL needs its own
-- auth.uid() = user_id policies written and committed to supabase/. See CLAUDE.md
-- rule 4. This file mirrors the live definition exactly (pulled via
-- pg_get_functiondef); it is idempotent and safe to re-run.

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
