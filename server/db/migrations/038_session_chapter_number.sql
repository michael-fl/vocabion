-- Add chapter_number to sessions for Breakthrough++ chapter tracking.
-- NULL for all session types except breakthrough_plus; 1-based for breakthrough_plus chapters.

ALTER TABLE sessions ADD COLUMN chapter_number INTEGER;
