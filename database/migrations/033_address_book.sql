ALTER TABLE addresses ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

WITH ranked AS(
  SELECT id,row_number() OVER(PARTITION BY user_id ORDER BY created_at,id) position
  FROM addresses WHERE is_default
)
UPDATE addresses SET is_default=false,updated_at=now()
WHERE id IN(SELECT id FROM ranked WHERE position>1);

CREATE UNIQUE INDEX addresses_one_default_per_user_idx ON addresses(user_id) WHERE is_default;
ALTER TABLE addresses ADD CONSTRAINT addresses_label_length CHECK(char_length(label) BETWEEN 1 AND 60);
ALTER TABLE addresses ADD CONSTRAINT addresses_formatted_length CHECK(char_length(formatted_address) BETWEEN 3 AND 240);
