-- New companies start with the official DeedWood teal. Existing companies keep their color.
ALTER TABLE "Organization" ALTER COLUMN "brandColor" SET DEFAULT '#0C4C54';
