ALTER TABLE dispatch_offers
  ADD COLUMN score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dispatch_offers
  ADD CONSTRAINT dispatch_offers_score_breakdown_object
  CHECK(jsonb_typeof(score_breakdown)='object');
