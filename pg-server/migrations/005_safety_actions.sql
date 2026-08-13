BEGIN;

ALTER TABLE runtime.tasks
  ADD COLUMN IF NOT EXISTS exception_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamp without time zone;

ALTER TABLE runtime.drones DROP CONSTRAINT IF EXISTS drones_status_check;
ALTER TABLE runtime.drones
  ADD CONSTRAINT drones_status_check CHECK (
    status = ANY (ARRAY['idle', 'task', 'returning', 'charging', 'maintenance', 'offline'])
  );

COMMIT;
