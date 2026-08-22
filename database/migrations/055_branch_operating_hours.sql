ALTER TABLE merchant_branches ADD COLUMN timezone text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';

CREATE TABLE branch_operating_hours(
  branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(branch_id,weekday)
);

CREATE TABLE branch_schedule_exceptions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  is_open boolean NOT NULL,
  opens_at time,
  closes_at time,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(branch_id,local_date),
  CHECK((NOT is_open) OR (opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

INSERT INTO branch_operating_hours(branch_id,weekday,opens_at,closes_at)
SELECT b.id,d,'00:00','00:00' FROM merchant_branches b CROSS JOIN generate_series(0,6) d;

CREATE OR REPLACE FUNCTION app.branch_is_scheduled_open(target_branch uuid,at_time timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE branch_tz text; local_now timestamp; today_exception branch_schedule_exceptions%ROWTYPE; previous_exception branch_schedule_exceptions%ROWTYPE; today_hours branch_operating_hours%ROWTYPE; previous_hours branch_operating_hours%ROWTYPE;
BEGIN
 SELECT timezone INTO branch_tz FROM merchant_branches WHERE id=target_branch;
 IF branch_tz IS NULL THEN RETURN false; END IF;
 BEGIN local_now:=at_time AT TIME ZONE branch_tz; EXCEPTION WHEN invalid_parameter_value THEN RETURN false; END;
 SELECT * INTO today_exception FROM branch_schedule_exceptions WHERE branch_id=target_branch AND local_date=local_now::date;
 IF FOUND THEN
  IF NOT today_exception.is_open THEN RETURN false; END IF;
  IF today_exception.opens_at=today_exception.closes_at THEN RETURN true; END IF;
  IF today_exception.closes_at>today_exception.opens_at THEN RETURN local_now::time>=today_exception.opens_at AND local_now::time<today_exception.closes_at; END IF;
  RETURN local_now::time>=today_exception.opens_at OR local_now::time<today_exception.closes_at;
 END IF;
 SELECT * INTO previous_exception FROM branch_schedule_exceptions WHERE branch_id=target_branch AND local_date=(local_now::date-1);
 IF FOUND THEN RETURN previous_exception.is_open AND previous_exception.closes_at<previous_exception.opens_at AND local_now::time<previous_exception.closes_at; END IF;
 SELECT * INTO today_hours FROM branch_operating_hours WHERE branch_id=target_branch AND weekday=extract(dow FROM local_now)::smallint AND enabled;
 IF FOUND THEN
  IF today_hours.opens_at=today_hours.closes_at THEN RETURN true; END IF;
  IF today_hours.closes_at>today_hours.opens_at AND local_now::time>=today_hours.opens_at AND local_now::time<today_hours.closes_at THEN RETURN true; END IF;
  IF today_hours.closes_at<today_hours.opens_at AND local_now::time>=today_hours.opens_at THEN RETURN true; END IF;
 END IF;
 SELECT * INTO previous_hours FROM branch_operating_hours WHERE branch_id=target_branch AND weekday=((extract(dow FROM local_now)::int+6)%7)::smallint AND enabled;
 RETURN FOUND AND previous_hours.closes_at<previous_hours.opens_at AND local_now::time<previous_hours.closes_at;
END $$;

ALTER TABLE branch_operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_schedule_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_operating_hours_visible ON branch_operating_hours USING(EXISTS(SELECT 1 FROM merchant_branches b WHERE b.id=branch_id));
CREATE POLICY branch_schedule_exceptions_visible ON branch_schedule_exceptions USING(EXISTS(SELECT 1 FROM merchant_branches b WHERE b.id=branch_id));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON branch_operating_hours,branch_schedule_exceptions TO flash_runtime;
  GRANT EXECUTE ON FUNCTION app.branch_is_scheduled_open(uuid,timestamptz) TO flash_runtime;
  CREATE POLICY branch_operating_hours_runtime_service ON branch_operating_hours TO flash_runtime USING(true) WITH CHECK(true);
  CREATE POLICY branch_schedule_exceptions_runtime_service ON branch_schedule_exceptions TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT ON branch_operating_hours,branch_schedule_exceptions TO flash_rls_audit;
  GRANT EXECUTE ON FUNCTION app.branch_is_scheduled_open(uuid,timestamptz) TO flash_rls_audit;
 END IF;
END $$;
