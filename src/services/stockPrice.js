const cache = {}
let lastFetch = 0
const TTL = 120000

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let lastSourceUsed = null
let lastErrorMessage = null

const PROXY = 'https://corsproxy.io/?'

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
    lastSourceUsed = 'Yahoo Finance (direct)'
  } else {
    results = await tryYahooV8ViaProxy(need)
    if (Object.keys(results).length > 0) {
      lastSourceUsed = 'Yahoo Finance (via CORS proxy)'
    }
  }

  if (Object.keys(results).length === 0) {
    results = await tryGoogleViaProxy(need)
    if (Object.keys(results).length > 0) {
      lastSourceUsed = 'Google Finance (via CORS proxy)'
    }
  }

  if (Object.keys(results).length === 0) {
    lastSourceUsed = null
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
      lastErrorMessage = `Yahoo direct: ${e.message}`
    }
  })
  await Promise.allSettled(tasks)
  return results
}

async function tryYahooV8ViaProxy(symbols) {
  const results = {}
  const tasks = symbols.map(async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?interval=1d&range=1d`
      const r = await fetch(PROXY + encodeURIComponent(url), {
        headers: { 'User-Agent': UA },
      })
      const data = await r.json()
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (price != null) results[sym] = price
    } catch (e) {
      lastErrorMessage = `Yahoo proxy: ${e.message}`
    }
  })
  await Promise.allSettled(tasks)
  return results
}

async function tryGoogleViaProxy(symbols) {
  const results = {}
  const tasks = symbols.map(async (sym) => {
    try {
      const url = `https://www.google.com/finance/quote/${sym}:NSE`
      const r = await fetch(PROXY + encodeURIComponent(url), {
        headers: { 'User-Agent': UA },
      })
      const html = await r.text()
      const m = html.match(/"lastPrice":\s*\{\s*"value":\s*"?([0-9.]+)"?/)
      if (m && m[1]) {
        results[sym] = parseFloat(m[1])
      }
    } catch (e) {
      lastErrorMessage = `Google proxy: ${e.message}`
    }
  })
  await Promise.allSettled(tasks)
  return results
}
