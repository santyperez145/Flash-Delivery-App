ALTER TABLE shipment_details
  ADD COLUMN signature_required boolean NOT NULL DEFAULT false;

ALTER TABLE shipment_delivery_evidence
  ADD COLUMN signer_name text,
  ADD COLUMN signer_relationship text,
  ADD COLUMN consent_version text;

ALTER TABLE shipment_delivery_evidence
  ADD CONSTRAINT shipment_signature_metadata_check CHECK (
    evidence_type <> 'signature' OR (
      length(trim(signer_name)) BETWEEN 2 AND 120 AND
      signer_relationship IN ('recipient','authorized_person') AND
      consent_version = 'shipment-receipt-v1'
    )
  );

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
  GRANT SELECT(signer_name,signer_relationship,consent_version) ON shipment_delivery_evidence TO flash_rls_audit;
 END IF;
END $$;
