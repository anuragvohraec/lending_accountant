const cache = {}
let lastFetch = 0
const TTL = 120000

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let lastSourceUsed = null
let lastErrorMessage = null

export function getLastSourceInfo() {
  return { source: lastSourceUsed, error: lastErrorMessage }
}

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

  let results = {}
  lastErrorMessage = null

  results = await tryYahooV8(need)
  if (Object.keys(results).length > 0) {
    lastSourceUsed = 'Yahoo Finance v8'
  } else {
    results = await tryYahooV7(need)
    if (Object.keys(results).length > 0) {
      lastSourceUsed = 'Yahoo Finance v7'
    }
  }

  if (Object.keys(results).length === 0) {
    results = await tryGoogleFinance(need)
    if (Object.keys(results).length > 0) {
      lastSourceUsed = 'Google Finance'
    }
  }

  if (Object.keys(results).length === 0) {
    lastSourceUsed = null
    lastErrorMessage = 'All price sources are unavailable from this browser. Ad-blockers, VPNs, or CORS policies may be blocking the requests. Try disabling ad-blocker for this site or use a different browser.'
  }

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

async function tryYahooV8(symbols) {
  const results = {}
  const tasks = symbols.map(async (sym) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?interval=1d&range=1d`, {
        headers: { 'User-Agent': UA },
      })
      const data = await r.json()
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (price != null) results[sym] = price
    } catch (e) {
      lastErrorMessage = `Yahoo v8: ${e.message}`
    }
  })
  await Promise.allSettled(tasks)
  return results
}

async function tryYahooV7(symbols) {
  try {
    const q = symbols.map(s => `${s}.NS`).join(',')
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${q}`, {
      headers: { 'User-Agent': UA },
    })
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
    lastErrorMessage = `Yahoo v7: ${e.message}`
    return {}
  }
}

async function tryGoogleFinance(symbols) {
  const results = {}
  const tasks = symbols.map(async (sym) => {
    try {
      const r = await fetch(`https://www.google.com/finance/quote/${sym}:NSE`, {
        headers: { 'User-Agent': UA },
      })
      const html = await r.text()
      const m = html.match(/"lastPrice":\s*\{\s*"value":\s*"?([0-9.]+)"?/)
      if (m && m[1]) {
        results[sym] = parseFloat(m[1])
      }
    } catch (e) {
      lastErrorMessage = `Google Finance: ${e.message}`
    }
  })
  await Promise.allSettled(tasks)
  return results
}
