-- Failed or unavailable posts participate in metric refresh rotation without fabricating counters.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS insights_attempted_at timestamptz;
