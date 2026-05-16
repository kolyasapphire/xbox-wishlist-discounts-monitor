import { env } from '@cloudflare/workers-types'
import type { Env } from './main.ts'

export const createSendMessage = ({ chatId, token }: { chatId: string; token: string }) =>
async (
  text: string,
  options?: { [key: string]: unknown },
) => {
  if ((env as Env).FIRST_RUN) return

  const body = {
    chat_id: chatId,
    text,
    ...options,
  }

  const req = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  if (!req.ok) console.error(await req.json())
}
