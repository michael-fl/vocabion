-- Track when the "buy stars" offer was last dismissed or acted on.
-- The offer is suppressed until this date (YYYY-MM-DD, inclusive).
-- NULL means the offer has never been shown, so it should display immediately
-- once the user has enough credits.

ALTER TABLE credits ADD COLUMN stars_offer_snoozed_until TEXT;
