-- SkyNest 轻量 Demo：运输任务与事件时间线
-- 本迁移不修改既有格网表，专门由 run-migrations.js 执行。

CREATE TABLE IF NOT EXISTS demo_tasks (
  id UUID PRIMARY KEY,
  request_no TEXT NOT NULL UNIQUE,
  requester_role TEXT NOT NULL DEFAULT 'student',
  requester_org TEXT NOT NULL DEFAULT '环境学院',
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  origin_text TEXT NOT NULL,
  destination_text TEXT NOT NULL,
  origin_node_id TEXT NOT NULL,
  destination_node_id TEXT NOT NULL,
  item_category TEXT NOT NULL,
  weight_kg DOUBLE PRECISION NOT NULL CHECK (weight_kg > 0),
  deadline TIMESTAMPTZ NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'high', 'emergency')),
  special_requirements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN (
    'SUBMITTED',
    'AGENT_REVIEWED',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'PROVIDER_ACCEPTED',
    'READY_FOR_TAKEOFF',
    'IN_FLIGHT',
    'ARRIVED',
    'PICKED_UP',
    'COMPLETED',
    'EXCEPTION',
    'CANCELLED'
  )),
  agent_result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  route_result_json JSONB,
  provider_code TEXT,
  provider_name TEXT,
  provider_order_no TEXT UNIQUE,
  provider_vehicle TEXT,
  provider_status TEXT,
  telemetry_json JSONB,
  pickup_code TEXT,
  exception_reason TEXT,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_tasks_status_updated
  ON demo_tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_demo_tasks_created_at
  ON demo_tasks (created_at DESC);

CREATE TABLE IF NOT EXISTS demo_task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES demo_tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_task_events_task_created
  ON demo_task_events (task_id, created_at ASC, id ASC);
