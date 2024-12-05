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

    let minPrice: number | undefined
    let minPricePercent: number | undefined
    let minPriceBonus: number | undefined
    let minPricePercentBonus: number | undefined
    let shouldGet = false

    try {
      const searchRes = await fetch(`https://xbdeals.net/gb-store/search?search_query=${name}`)
      const searchBody = await searchRes.text()
      const searchParsed = parse(searchBody)
      const games = searchParsed.querySelectorAll('.game-collection-item-link')
      if (!games.length) throw new Error('Parsing search page failed')

      const ourGame = games.find((x) => {
        const price = x.querySelector('.game-collection-item-price')
        if (!price) throw new Error('No price class on search page')
        const parsedPrice = Number.parseFloat(price.textContent.slice(1))
        return parsedPrice === prices[0]
      })

      if (!ourGame) throw new Error('Our game is not on search page')

      const gameRes = await fetch(`https://xbdeals.net${ourGame.attributes.href}`)
      const gameBody = await gameRes.text()
      const gameParsed = parse(gameBody)

      const discounted = gameParsed.querySelector(
        '.game-stats-price-history > div:nth-child(2) > p.game-stats-col-number > span',
      )
      if (!discounted) throw new Error('Could not parse discounted price on game page')
      minPrice = Number.parseFloat(discounted.textContent.slice(1))
      minPricePercent = Math.round((1 - minPrice / prices[0]) * 100)

      const discountedBonus = gameParsed.querySelector(
        '.game-stats-price-history > div:nth-child(3) > p.game-stats-col-number > span',
      )
      if (!discountedBonus) throw new Error('Could not parse discounted bonus price on game page')
      const isFree = discountedBonus.textContent === 'Free'
      minPriceBonus = Number.parseFloat(isFree ? discountedBonus.textContent.slice(1) : '0.0')
      minPricePercentBonus = isFree ? 100 : Math.round((1 - minPriceBonus / prices[0]) * 100)

      shouldGet = prices[1] <= minPrice || prices[1] <= minPriceBonus
    } catch (e: unknown) {
      console.error(name, 'Failed to get mimimum prices:', (e as Error).message)
    }

    if (discount >= Number.parseInt(MIN_DISCOUNT_PERCENT)) {
      if (!(await kv.get([`${name}-${discount}`])).value) {
        const lines = [
          `${name} by ${publisher}`,
          '', // spacer
          `${discount}% ($${prices[0]} -> $${prices[1]})`,
          '', // spacer
        ]

        if (minPrice) {
          lines.push(
            'Historical minimum:',
            `$${minPrice} (${minPricePercent}% discount)`,
            `$${minPriceBonus} (${minPricePercentBonus}% discount) with Game Pass`,
            '',
          )
        }

        if (shouldGet) lines.push('Get it now!', '')

        if (link) lines.push(link)

        await sendMessage(lines.join('\n'), { parse_mode: 'HTML' })

        await kv.set([`${name}-${discount}`], true, {
          expireIn: 60 * 60 * 24 * 14 * 1000, // 2 weeks expiry
        })
      }
      console.debug(name, 'discounted', `${discount}%`, 'sent notification')
    } else {
      console.debug(name, 'discounted', `${discount}%`, 'already notified')
    }
  }
}

Deno.cron('job', '0 16 * * *', job)
