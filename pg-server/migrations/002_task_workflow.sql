BEGIN;

ALTER TABLE runtime.tasks
  ADD COLUMN IF NOT EXISTS input_text text,
  ADD COLUMN IF NOT EXISTS requester jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS agent_analysis jsonb;

CREATE INDEX IF NOT EXISTS idx_runtime_tasks_status_updated
  ON runtime.tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_approvals_task_created
  ON runtime.approvals (task_id, created_at DESC);

COMMIT;
