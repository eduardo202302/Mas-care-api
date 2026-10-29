import { MessagingError } from '../../domain/messaging/provider.js';

type Fetch = typeof fetch;

/** One Bot API call. Errors never carry the Telegram description, which can echo chat data. */
async function call<T>(token: string, method: string, body: object, fetchImpl: Fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MessagingError('Telegram request failed', false, 'tg_network');
  }
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error_code?: number };
  if (!response.ok || !payload.ok) {
    const code = payload.error_code ?? response.status;
    // 400 bad request or chat not found, 401 revoked token, 403 the patient blocked the bot: retrying cannot fix them.
    const permanent = code === 400 || code === 401 || code === 403 || code === 404;
    throw new MessagingError('Telegram rejected the request', permanent, `tg_${code}`);
  }
  return payload.result as T;
}

export const telegramApi = {
  getMe: (token: string, fetchImpl?: Fetch) => call<{ id: number; username: string; is_bot: boolean }>(token, 'getMe', {}, fetchImpl),
  setWebhook: (token: string, url: string, secretToken: string, fetchImpl?: Fetch) =>
    call<boolean>(token, 'setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }, fetchImpl),
  deleteWebhook: (token: string, fetchImpl?: Fetch) => call<boolean>(token, 'deleteWebhook', { drop_pending_updates: true }, fetchImpl),
  sendMessage: (token: string, body: object, fetchImpl?: Fetch) => call<{ message_id: number }>(token, 'sendMessage', body, fetchImpl),
  answerCallbackQuery: (token: string, callbackQueryId: string, fetchImpl?: Fetch) => call<boolean>(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId }, fetchImpl),
};
