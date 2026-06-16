const cache = {}
let lastFetch = 0
const TTL = 60000

export function getCachedPrice(symbol) {
  const c = cache[symbol.toUpperCase()]
  return c ? c.price : null
}

export function isStale() {
  return Date.now() - lastFetch > TTL
}

export async function fetchPrices(symbols) {
  const now = Date.now()
  const need = symbols.filter(s => {
    const c = cache[s.toUpperCase()]
    return !c || now - c.ts > TTL
  })
  if (need.length === 0) return buildMap()

  const results = await tryYahoo(need)
  for (const [sym, price] of Object.entries(results)) {
    cache[sym.toUpperCase()] = { price, ts: now }
  }
  lastFetch = now
  return buildMap()
}

function buildMap() {
  const m = {}
  for (const [sym, c] of Object.entries(cache)) m[sym] = c.price
  return m
}

async function tryYahoo(symbols) {
  try {
    const q = symbols.map(s => `${s}.NS`).join(',')
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${q}`)
    const data = await r.json()
    const result = {}
    for (const item of (data?.quoteResponse?.result || [])) {
      const sym = item.symbol.replace('.NS', '')
      if (item.regularMarketPrice != null) {
        result[sym] = item.regularMarketPrice
      }
    }
    return result
  } catch (e) {
    console.warn('Yahoo Finance quote unavailable:', e)
    return {}
  }
}
