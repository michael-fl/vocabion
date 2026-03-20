-- Mark words added manually via the UI so they are prioritised in the next session.
-- Words added via JSON import (importEntries) are NOT marked.
ALTER TABLE vocab_entries ADD COLUMN manually_added INTEGER NOT NULL DEFAULT 0;
