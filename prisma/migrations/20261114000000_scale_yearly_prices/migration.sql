-- Scale yearly prices were stored as monthly-equivalent cents ($1.45 / $1.25). The yearly price is
-- $17.40/unit for units 1-250 and $15.00/unit above 250 (Stripe: scale_unit_yearly_tiered).
-- Only rows still holding the old defaults are changed, so prices edited in /admin -> Plans stay.
UPDATE "Plan" SET "annualPerUnitCents" = 1740, "volumeAnnualCents" = 1500
WHERE "key" = 'hosted_scale' AND "annualPerUnitCents" = 145 AND "volumeAnnualCents" = 125;
