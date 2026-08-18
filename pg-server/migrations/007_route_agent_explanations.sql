ALTER TABLE runtime.routes
  ADD COLUMN IF NOT EXISTS agent_explanation jsonb,
  ADD COLUMN IF NOT EXISTS explanation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS explanation_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS explanation_error text;
