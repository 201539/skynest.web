BEGIN;

ALTER TABLE runtime.routes
  ADD COLUMN IF NOT EXISTS previous_route_id bigint,
  ADD COLUMN IF NOT EXISTS algorithm text,
  ADD COLUMN IF NOT EXISTS cost_model text,
  ADD COLUMN IF NOT EXISTS planning_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cost_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS change_trigger jsonb,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routes_previous_route_id_fkey'
      AND conrelid = 'runtime.routes'::regclass
  ) THEN
    ALTER TABLE runtime.routes
      ADD CONSTRAINT routes_previous_route_id_fkey
      FOREIGN KEY (previous_route_id)
      REFERENCES runtime.routes(route_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_route_previous
  ON runtime.routes (previous_route_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_route_current_task
  ON runtime.routes (task_id)
  WHERE is_current;

CREATE OR REPLACE FUNCTION runtime.notify_dynamic_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  record_data jsonb;
  record_id text;
  notification jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    record_data := to_jsonb(OLD);
  ELSE
    record_data := to_jsonb(NEW);
  END IF;

  record_id := COALESCE(
    record_data ->> 'zone_id',
    record_data ->> 'weather_id',
    record_data ->> 'site_id',
    record_data ->> 'event_id'
  );

  notification := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'operation', lower(TG_OP),
    'record_id', record_id,
    'changed_at', clock_timestamp()
  );
  PERFORM pg_notify('skynest_dynamic_change', notification::text);
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS notify_no_fly_zone_change ON runtime.no_fly_zones;
CREATE TRIGGER notify_no_fly_zone_change
AFTER INSERT OR UPDATE OR DELETE ON runtime.no_fly_zones
FOR EACH ROW EXECUTE FUNCTION runtime.notify_dynamic_change();

DROP TRIGGER IF EXISTS notify_weather_change ON runtime.weather;
CREATE TRIGGER notify_weather_change
AFTER INSERT OR UPDATE OR DELETE ON runtime.weather
FOR EACH ROW EXECUTE FUNCTION runtime.notify_dynamic_change();

DROP TRIGGER IF EXISTS notify_construction_change ON runtime.construction;
CREATE TRIGGER notify_construction_change
AFTER INSERT OR UPDATE OR DELETE ON runtime.construction
FOR EACH ROW EXECUTE FUNCTION runtime.notify_dynamic_change();

DROP TRIGGER IF EXISTS notify_event_change ON runtime.events;
CREATE TRIGGER notify_event_change
AFTER INSERT OR UPDATE OR DELETE ON runtime.events
FOR EACH ROW EXECUTE FUNCTION runtime.notify_dynamic_change();

COMMIT;
