export const createSendMessage =
  ({ BOT_CHAT, BOT_TOKEN }: { BOT_CHAT: string; BOT_TOKEN: string }) =>
  async (
    text: string,
    options?: { [key: string]: unknown },
  ) => {
    if (Deno.env.get('DRY_MODE') === 'true') return

    const body = {
      chat_id: BOT_CHAT,
      text,
      ...options,
    }

    const req = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    if (!req.ok) console.error(await req.json())
  }
