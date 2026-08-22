ALTER TABLE pricing_change_requests
  ADD COLUMN change_kind text NOT NULL DEFAULT 'update' CHECK(change_kind IN('update','rollback')),
  ADD COLUMN source_pricing_plan_id uuid REFERENCES pricing_plans(id),
  ADD COLUMN risk_level text NOT NULL DEFAULT 'low' CHECK(risk_level IN('low','medium','high')),
  ADD COLUMN maximum_change_percent numeric(10,2) NOT NULL DEFAULT 0 CHECK(maximum_change_percent>=0),
  ADD COLUMN risk_warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(risk_warnings)='array');

CREATE INDEX pricing_change_requests_risk_queue_idx
  ON pricing_change_requests(risk_level,status,effective_at)
  WHERE status IN('pending','approved');
