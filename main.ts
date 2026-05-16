import { createSendMessage } from './sendMessage.ts'
import { getWishlist } from './getWishlist.ts'

export interface Env {
  KV: KVNamespace
  WISHLIST_ID: string
  MIN_DISCOUNT_PERCENT: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID?: string
  FIRST_RUN?: string
}

const job: ExportedHandler<Env>['scheduled'] = async (_, env) => {
  const WISHLIST_ID = env.WISHLIST_ID
  const MIN_DISCOUNT_PERCENT = env.MIN_DISCOUNT_PERCENT // percentage
  const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN
  const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID || '-1002125188525'

  if (!WISHLIST_ID || !MIN_DISCOUNT_PERCENT || !TELEGRAM_BOT_TOKEN) throw new Error('Bad config')

  const sendMessage = createSendMessage({ token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID })

  const games = await getWishlist(WISHLIST_ID)

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

    if ((await env.KV.get(`${name}-${discount}`))) {
      console.debug(name, 'discounted', `${discount}%`, 'already notified')
      continue
    }

    if (discount >= Number.parseInt(MIN_DISCOUNT_PERCENT, 10)) {
      let minPrice: number | undefined
      let minPricePercent: number | undefined
      let shouldGet = false

      const ourHistoricalMinimum = Number(await env.KV.get(`historicalMinimum-${name}`))

      if (ourHistoricalMinimum) {
        minPrice = ourHistoricalMinimum
        minPricePercent = Math.round((1 - ourHistoricalMinimum / prices[0]) * 100)
        shouldGet = prices[1] <= ourHistoricalMinimum
      }

      const lines = [
        `${name} by ${publisher}`,
        '', // spacer
        `${discount}% (£${prices[0]} -> £${prices[1]})`,
        '', // spacer
      ]

      if (minPrice) lines.push('Historical minimum:', `${minPricePercent}% (£${minPrice})`, '')

      if (shouldGet) lines.push('Get it now!', '')

      if (link) lines.push(link)

      await sendMessage(lines.join('\n'), { parse_mode: 'HTML' })

      await env.KV.put(`${name}-${discount}`, 'done', {
        expirationTtl: 60 * 60 * 24 * 14, // 2 weeks expiry, seconds!
      })
      if (!ourHistoricalMinimum || prices[1] < ourHistoricalMinimum) {
        await env.KV.put(`historicalMinimum-${name}`, String(prices[1]), {
          expirationTtl: 60 * 60 * 24 * 7 * 4 * 12, // 1 year expiry, seconds!
        })
      }

      console.debug(name, 'discounted', `${discount}%`, 'sent notification')
    } else {
      console.debug(name, 'discount too low', `(${discount}%)`)
    }
  }
}

export default { scheduled: job } satisfies ExportedHandler<Env>
