ALTER TABLE job_cancellations ADD CONSTRAINT job_cancellations_reason_detail_length
  CHECK(reason_detail IS NULL OR char_length(reason_detail)<=500);
ALTER TABLE job_cancellations ADD CONSTRAINT job_cancellations_other_requires_detail
  CHECK(reason_code<>'other' OR char_length(trim(reason_detail))>=3);
