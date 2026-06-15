export function calcDaysHeld(date) {
  const d = new Date(date + 'T12:00:00')
  const now = new Date()
  return Math.max(0, Math.floor((now - d) / (1000 * 60 * 60 * 24)))
}

export function calcV1(price, M) {
  return price + price * M / 100
}

export function calcV2(price, R, days) {
  return price + price * R * days / 3000
}

export function calcCurrentValue(price, R, M, days) {
  return Math.max(calcV1(price, M), calcV2(price, R, days))
}

export function calcAvgBuyPrice(entries) {
  const totalQty = entries.reduce((s, e) => s + e.remainingQty, 0)
  if (totalQty === 0) return 0
  return entries.reduce((s, e) => s + e.remainingQty * e.price, 0) / totalQty
}

export function calcAvgDays(entries) {
  const totalQty = entries.reduce((s, e) => s + e.remainingQty, 0)
  if (totalQty === 0) return 0
  return entries.reduce((s, e) => s + e.remainingQty * calcDaysHeld(e.date), 0) / totalQty
}

export function calcTotalQty(entries) {
  return entries.reduce((s, e) => s + e.remainingQty, 0)
}

export function calcAggregatedCurrentValue(entries) {
  const totalQty = entries.reduce((s, e) => s + e.remainingQty, 0)
  if (totalQty === 0) return 0
  const totalVal = entries.reduce((s, e) => {
    const days = calcDaysHeld(e.date)
    return s + e.remainingQty * calcCurrentValue(e.price, e.monthlyRate, e.minReturn, days)
  }, 0)
  return totalVal / totalQty
}

export function sellLIFO(entries, sellQty) {
  const sorted = [...entries].filter(e => e.remainingQty > 0).sort((a, b) => new Date(b.date) - new Date(a.date))
  let remaining = sellQty
  const allocations = []
  for (const entry of sorted) {
    if (remaining <= 0) break
    const take = Math.min(entry.remainingQty, remaining)
    allocations.push({ entry, take })
    remaining -= take
  }
  if (remaining > 0) return null
  return allocations
}
