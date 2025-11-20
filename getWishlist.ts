import { parse } from 'node-html-parser'

const headers = {
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
}

export const getWishlist = async (id: string) => {
  const res = await fetch(`https://www.xbox.com/en-GB/wishlist/${id}`, { headers })
  const text = await res.text()
  const parsed = parse(text)

  const rows = parsed.querySelector('#PageContent > div > div > div')

  if (!rows) throw new Error('HTML structure has changed')

  const games = rows.querySelectorAll('div > div > div:nth-child(2)')

  return games
}
