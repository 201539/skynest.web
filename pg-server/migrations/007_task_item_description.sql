BEGIN;

ALTER TABLE runtime.tasks
  ADD COLUMN IF NOT EXISTS item_description text;

UPDATE runtime.tasks
SET item_description = item_category
WHERE item_description IS NULL OR btrim(item_description) = '';

COMMIT;
