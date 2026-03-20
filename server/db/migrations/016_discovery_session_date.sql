-- Track the last date a discovery session was completed so at most one runs per calendar day.
ALTER TABLE credits ADD COLUMN last_discovery_session_date TEXT;
