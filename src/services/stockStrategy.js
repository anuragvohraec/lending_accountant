import { getDb } from '../db/database.js'

export function calc1234Lots({ SQ, ASP, MBP, buybackRatio, targetAvgFactor, granularity }) {
  const totalBuyQty = Math.round(SQ * buybackRatio)
  const targetAvg = ASP * targetAvgFactor
  const D = (MBP - targetAvg) / 2

  function splitQty(total, ratios) {
    const rSum = ratios.reduce((s, r) => s + r, 0)
    const base = ratios.map(r => Math.floor(total * r / rSum))
    let rem = total - base.reduce((s, v) => s + v, 0)
    for (let i = base.length - 1; i >= 0 && rem > 0; i--) { base[i]++; rem-- }
    return base
  }

  function genLevel(price, qty, depth) {
    if (depth >= granularity) return [{ qty, price: round2(price) }]
    const step = D / Math.pow(4, depth - 1) / 4
    const subQtys = splitQty(qty, [1, 2, 3, 4])
    const results = []
    for (let i = 0; i < 4; i++) {
      const subPrice = price + step * (2 - i)
      results.push(...genLevel(subPrice, subQtys[i], depth + 1))
    }
    return results
  }

  const lots = []
  const levelQties = splitQty(totalBuyQty, [1, 2, 3, 4])
  for (let i = 0; i < 4; i++) {
    const price = MBP - i * D
    lots.push(...genLevel(price, levelQties[i], 1))
  }

  const totalQty = lots.reduce((s, l) => s + l.qty, 0)
  const totalCost = lots.reduce((s, l) => s + l.qty * l.price, 0)

  return {
    lots,
    totalQty,
    totalCost: round2(totalCost),
    avgPrice: totalQty > 0 ? round2(totalCost / totalQty) : 0,
    rangeLow: lots.length > 0 ? lots[lots.length - 1].price : 0,
    rangeHigh: lots.length > 0 ? lots[0].price : 0,
    D,
    targetAvg,
    totalBuyQty,
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export function computeExistingHoldings(lots, activeEntries) {
  const sorted = [...lots].sort((a, b) => b.price - a.price)
  return sorted.map((lot, i) => {
    const nextPrice = i > 0 ? sorted[i - 1].price : Infinity
    const matched = activeEntries.filter(e => e.price >= lot.price && e.price < nextPrice)
    const existing = matched.reduce((s, e) => s + e.remainingQty, 0)
    const existingAvgPrice = existing > 0 ? matched.reduce((s, e) => s + e.remainingQty * e.price, 0) / existing : 0
    return { ...lot, existing, existingAvgPrice }
  })
}

export async function getStrategies(stockId) {
  const all = await allDocs('strategy_')
  return stockId ? all.filter(s => s.stockId === stockId) : all
}

export async function getStrategy(id) {
  return getDb().get(id)
}

export async function saveStrategy(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'strategy_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  data.filledLots = data.filledLots || {}
  return db.put(data)
}

export async function deleteStrategy(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

async function allDocs(prefix) {
  const result = await getDb().allDocs({
    startkey: prefix,
    endkey: prefix + '\uffff',
    include_docs: true,
  })
  return result.rows.map(r => r.doc).filter(d => !d._deleted)
}

export function computeStockSoldMetrics(entries) {
  const sold = entries.filter(e => e.status === 'sold' && e.soldDate)
  const SQ = sold.reduce((s, e) => s + e.qty, 0)
  const ASP = SQ > 0 ? sold.reduce((s, e) => s + e.qty * e.soldPrice, 0) / SQ : 0
  return { SQ, ASP }
}
