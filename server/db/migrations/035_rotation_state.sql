-- Persist the round-robin session rotation state across server restarts.
--
-- rotation_sequence : JSON array of session-type strings representing the current
--                     shuffled rotation order (e.g. '["normal","stress",...]').
--                     NULL means the sequence has not been initialised yet.
-- rotation_index    : Next position to read from rotation_sequence.
-- rotation_last_type: The session type that was last played, used to prevent
--                     the same type from firing twice in a row after a reshuffle.

ALTER TABLE credits ADD COLUMN rotation_sequence  TEXT;
ALTER TABLE credits ADD COLUMN rotation_index     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credits ADD COLUMN rotation_last_type TEXT;
