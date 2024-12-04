import { parse } from 'node-html-parser'
import { load } from '@std/dotenv'

await load({ export: true })

const WISHLIST_ID = Deno.env.get('WISHLIST_ID')
const MIN_DISCOUNT_PERCENT = Deno.env.get('MIN_DISCOUNT_PERCENT') // percentage
const BOT_TOKEN = Deno.env.get('BOT_TOKEN')
const BOT_CHAT = Deno.env.get('BOT_CHAT')

const job = async () => {
  if (!WISHLIST_ID || !MIN_DISCOUNT_PERCENT || !BOT_TOKEN || !BOT_CHAT) {
    console.error('Bad config')
    return
  }

  const sendMessage = async (
    text: string,
    options?: { [key: string]: unknown },
  ) => {
    const body = {
      chat_id: BOT_CHAT,
      text,
      ...options,
    }

    const req = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    if (!req.ok) {
      console.error(await req.json())
    }
  }

  const res = await fetch(
    `https://www.xbox.com/en-GB/wishlist/${WISHLIST_ID}`,
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-GB,en;q=0.9',
        Connection: 'keep-alive',
        Cookie:
          'MUID=6E62D6A40F8044868A00E473B73CF8B5; MicrosoftApplicationsTelemetryDeviceId=f8162252-c2b1-4548-852a-6b8a1346291c; ai_session=2N7Uvd7PS2e7LMEnvlIKgM|1714583942031|1714583942503; aka_locale=en-us',
        Host: 'www.xbox.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
      },
    },
  )
  const text = await res.text()
  const parsed = parse(text)

  const rows = parsed.querySelector('#PageContent > div > div > div')

  const kv = await Deno.openKv()

  // HTML has changed
  if (!rows) {
    // Notify in channel and pause running via kv for some time
    if (!(await kv.get(['broken'])).value) {
      await sendMessage('Parsing broke :(', { parse_mode: 'HTML' })
      await kv.set(['broken'], true, {
        expireIn: 60 * 60 * 24 * 3 * 1000, // 3 days expiry
      })
    } else {
      console.debug('already notified that parsing broke')
    }

    return
  }

  const games = rows.querySelectorAll('div > div > div:nth-child(2)')

  console.debug('Parsed', games.length, 'games')

  for (const game of games) {
    const info = game.querySelectorAll('*')

    const [name, publisher, priceRaw] = [info[0].text, info[1].text, info[2]]

    const link = info[0].getAttribute('href')

    // [fullPrice, discountedPrice]
    const prices = priceRaw
      .querySelectorAll('span')
      .map((x) => x.text)
      .map((x) => x.split('£')[1])
      .map(Number.parseFloat)

    // Already free or has gifting restrictions
    if (priceRaw.text.includes('not eligible') || !prices.length) {
      console.debug(name, 'not eligible')
      continue
    }

    // Regular price
    if (prices.length === 1) {
      console.debug(name, 'no discount')
      continue
    }

    const discount = Math.round((1 - prices[1] / prices[0]) * 100)

    if (discount >= Number.parseInt(MIN_DISCOUNT_PERCENT)) {
      if (!(await kv.get([`${name}-${discount}`])).value) {
        await sendMessage(
          [
            `${name} by ${publisher}`,
            '', // spacer
            `${discount}% ($${prices[0]} -> $${prices[1]})`,
            '', // spacer
            link,
          ].join('\n'),
          { parse_mode: 'HTML' },
        )
        await kv.set([`${name}-${discount}`], true, {
          expireIn: 60 * 60 * 24 * 7 * 1000, // 7 days expiry
        })
      }
      console.debug(name, 'discounted', `${discount}%`, 'sent notification')
    } else {
      console.debug(name, 'discounted', `${discount}%`, 'already notified')
    }
  }
}

Deno.cron('job', '0 16 * * *', job)
