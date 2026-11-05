-- How the site looks for this person (card style, theme): kept in the account so it follows them to every device.
ALTER TABLE "User" ADD COLUMN "uiPrefs" JSONB;
