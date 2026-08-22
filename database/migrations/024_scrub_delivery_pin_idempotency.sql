UPDATE idempotency_keys
SET response_body=response_body #- '{shipment,deliveryPin}'
WHERE response_body #> '{shipment,deliveryPin}' IS NOT NULL;
