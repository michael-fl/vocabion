-- Adds stress_high_stakes flag to sessions.
-- Stress sessions now fire without a credit balance requirement. The fee mode
-- (high-stakes vs. standard) is determined once at session creation based on
-- the balance at that moment and stored here so it remains stable throughout
-- the session even as credits are earned or spent.
--
-- NULL  = not a stress session (or a stress session created before this migration)
-- 0     = standard mode (balance was < 500 at session start)
-- 1     = high-stakes mode (balance was >= 500 at session start)

ALTER TABLE sessions ADD COLUMN stress_high_stakes INTEGER;
