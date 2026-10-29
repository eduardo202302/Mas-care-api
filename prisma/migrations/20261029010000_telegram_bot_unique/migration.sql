-- A bot has a single webhook, so it can belong to one organization only.
CREATE UNIQUE INDEX "telegram_accounts_bot_username_key" ON "telegram_accounts"("bot_username");
