import { getDb } from '../db/database.js'

async function allDocs(prefix) {
  const result = await getDb().allDocs({
    startkey: prefix,
    endkey: prefix + '\uffff',
    include_docs: true,
  })
  return result.rows.map(r => r.doc).filter(d => !d._deleted)
}

// ── WAREHOUSE ──

export async function getWarehouses() {
  return allDocs('warehouse_')
}

export async function getWarehouse(id) {
  return getDb().get(id)
}

export async function saveWarehouse(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'warehouse_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  return db.put(data)
}

export async function deleteWarehouse(id) {
  const db = getDb()
  const halls = await getHalls(id)
  for (const h of halls) {
    const sections = await getSections(h._id)
    for (const s of sections) await deleteSection(s._id)
    await db.remove(h)
  }
  const doc = await db.get(id)
  return db.remove(doc)
}

// ── HALLS ──

export async function getHalls(warehouseId) {
  const all = await allDocs('whall_')
  return all.filter(h => h.warehouseId === warehouseId)
}

export async function saveHall(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'whall_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteHall(id) {
  const db = getDb()
  const sections = await getSections(id)
  for (const s of sections) await deleteSection(s._id)
  const doc = await db.get(id)
  return db.remove(doc)
}

// ── SECTIONS ──

export async function getSections(hallId) {
  const all = await allDocs('wsec_')
  return all.filter(s => s.hallId === hallId)
}

export async function saveSection(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'wsec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteSection(id) {
  const db = getDb()
  const stocks = await getStocksBySection(id)
  for (const st of stocks) await deleteStock(st._id)
  const doc = await db.get(id)
  return db.remove(doc)
}

// ── STOCKS ──

export async function getStocksBySection(sectionId) {
  const all = await allDocs('wstock_')
  return all.filter(s => s.sectionId === sectionId)
}

export async function getStocksByWarehouse(warehouseId) {
  const halls = await getHalls(warehouseId)
  const all = await allDocs('wstock_')
  const hallIds = new Set(halls.map(h => h._id))
  const secIds = new Set()
  for (const h of halls) {
    const secs = await getSections(h._id)
    secs.forEach(s => secIds.add(s._id))
  }
  return all.filter(s => secIds.has(s.sectionId))
}

export async function getStock(id) {
  return getDb().get(id)
}

export async function saveStock(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'wstock_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  data.notes = data.notes || []
  return db.put(data)
}

export async function deleteStock(id) {
  const db = getDb()
  const txns = await getStockTxns(id)
  for (const t of txns) await db.remove(t)
  const doc = await db.get(id)
  return db.remove(doc)
}

// ── STOCK TRANSACTIONS (qty changes) ──

export async function getStockTxns(stockId) {
  const all = await allDocs('wstocktxn_')
  return all.filter(t => t.stockId === stockId).sort((a, b) => new Date(b.date) - new Date(a.date))
}

export async function addStockTxn({ stockId, type, delta, prevQty, newQty, note, warehouseName, hallName, sectionName, partyName, itemName }) {
  const db = getDb()
  const doc = {
    _id: 'wstocktxn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    stockId, type, delta, prevQty, newQty, note: note || '',
    warehouseName: warehouseName || '',
    hallName: hallName || '',
    sectionName: sectionName || '',
    partyName: partyName || '',
    itemName: itemName || '',
    date: new Date().toISOString(),
  }
  return db.put(doc)
}

// ── NOTES on stock ──

export async function addStockNote(stockId, text) {
  const stock = await getStock(stockId)
  const notes = stock.notes || []
  notes.push({ text, date: new Date().toISOString() })
  return saveStock({ _id: stockId, notes })
}

// ── BILLS ──

export async function getBills(warehouseId, partyId) {
  const all = await allDocs('wbill_')
  let filtered = all
  if (warehouseId) filtered = filtered.filter(b => b.warehouseId === warehouseId)
  if (partyId) filtered = filtered.filter(b => b.partyId === partyId)
  return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export async function saveBill(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'wbill_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteBill(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getParties() {
  return allDocs('party_')
}
