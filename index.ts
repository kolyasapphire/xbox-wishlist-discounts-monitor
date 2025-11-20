import { load } from '@std/dotenv'
await load({ export: true })

import { createSendMessage } from './sendMessage.ts'
import { getWishlist } from './getWishlist.ts'

const WISHLIST_ID = Deno.env.get('WISHLIST_ID')
const MIN_DISCOUNT_PERCENT = Deno.env.get('MIN_DISCOUNT_PERCENT') // percentage
const BOT_TOKEN = Deno.env.get('BOT_TOKEN')
const BOT_CHAT = Deno.env.get('BOT_CHAT')

const job = async () => {
  if (!WISHLIST_ID || !MIN_DISCOUNT_PERCENT || !BOT_TOKEN || !BOT_CHAT) {
    console.error('Bad config')
    return
  }

  const sendMessage = createSendMessage({ BOT_TOKEN, BOT_CHAT })

  const kv = await Deno.openKv()

  let games: Awaited<ReturnType<typeof getWishlist>>

  try {
    games = await getWishlist(WISHLIST_ID)
  } catch (_e) {
    // Notify in channel and pause running via kv for some time
    if (!(await kv.get(['broken'])).value) {
      await sendMessage('Parsing broke :(')
      if (Deno.env.get('NO_CACHE') !== 'true') {
        await kv.set(['broken'], true, {
          expireIn: 60 * 60 * 24 * 3 * 1000, // 3 days expiry
        })
      }
    } else {
      console.debug('already notified that parsing broke')
    }
    return
  }

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

    if ((await kv.get([`${name}-${discount}`])).value) {
      console.debug(name, 'discounted', `${discount}%`, 'already notified')
      continue
    }

    if (discount >= Number.parseInt(MIN_DISCOUNT_PERCENT, 10)) {
      let minPrice: number | undefined
      let minPricePercent: number | undefined
      let shouldGet = false

      const ourHistoricalMinimum = (await kv.get<number>(['historicalMinimum', name])).value

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

      if (Deno.env.get('NO_CACHE') !== 'true') {
        await kv.set([`${name}-${discount}`], true, {
          expireIn: 60 * 60 * 24 * 14 * 1000, // 2 weeks expiry
        })
        if (!ourHistoricalMinimum || prices[1] < ourHistoricalMinimum) {
          await kv.set(['historicalMinimum', name], prices[1], {
            expireIn: 60 * 60 * 24 * 7 * 4 * 12 * 1000, // 1 year expiry
          })
        }
      }

      console.debug(name, 'discounted', `${discount}%`, 'sent notification')
    } else {
      console.debug(name, 'discount too low', `(${discount}%)`)
    }
  }
}

Deno.cron('job', '0 16 * * *', job)
