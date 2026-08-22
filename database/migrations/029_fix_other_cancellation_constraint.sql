UPDATE job_cancellations SET reason_detail='Motivo no especificado'
WHERE reason_code='other' AND (reason_detail IS NULL OR char_length(trim(reason_detail))<3);
ALTER TABLE job_cancellations DROP CONSTRAINT job_cancellations_other_requires_detail;
ALTER TABLE job_cancellations ADD CONSTRAINT job_cancellations_other_requires_detail
  CHECK(reason_code<>'other' OR (reason_detail IS NOT NULL AND char_length(trim(reason_detail))>=3));
