const DB_NAME = 'lending_accountant'

let db

export function getDb() {
  if (!db) {
    db = new PouchDB(DB_NAME)
  }
  return db
}

async function allDocs(prefix) {
  const result = await getDb().allDocs({
    startkey: prefix,
    endkey: prefix + '\uffff',
    include_docs: true,
  })
  return result.rows.map((r) => r.doc).filter((d) => !d._deleted)
}

export async function getMoneySources() {
  return allDocs('money_source_')
}

export async function getMoneySource(id) {
  return getDb().get(id)
}

export async function saveMoneySource(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'money_source_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteMoneySource(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getParties() {
  return allDocs('party_')
}

export async function getParty(id) {
  return getDb().get(id)
}

export async function saveParty(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'party_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteParty(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getTransactions(partyId) {
  const all = await allDocs('txn_')
  if (partyId) return all.filter((t) => t.partyId === partyId).sort((a, b) => new Date(b.date) - new Date(a.date))
  return all.sort((a, b) => new Date(b.date) - new Date(a.date))
}

export async function getAllTransactions() {
  return allDocs('txn_')
}

export async function saveTransaction(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'txn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteTransaction(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getCollaterals(partyId) {
  const all = await allDocs('collateral_')
  if (partyId) return all.filter((c) => c.partyId === partyId).sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
  return all.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
}

export async function saveCollateral(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'collateral_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.dateAdded = new Date().toISOString()
  return db.put(data)
}

export async function deleteCollateral(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getAuditLogs(limit = 50) {
  const all = await allDocs('audit_')
  return all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit)
}

export async function addAuditLog(action, entityType, entityId, details = '') {
  const db = getDb()
  const doc = {
    _id: 'audit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    action,
    entityType,
    entityId,
    details,
    timestamp: new Date().toISOString(),
  }
  return db.put(doc)
}

export async function getSettings() {
  try {
    return await getDb().get('app_settings')
  } catch {
    return { _id: 'app_settings', pin: '', backupReminder: true, lastBackup: null }
  }
}

export async function saveSettings(settings) {
  const db = getDb()
  try {
    const existing = await db.get('app_settings')
    return db.put({ ...existing, ...settings })
  } catch {
    settings._id = 'app_settings'
    return db.put(settings)
  }
}

export async function getAllData() {
  const [sources, parties, txns, collaterals, auditLogs] = await Promise.all([
    getMoneySources(),
    getParties(),
    getAllTransactions(),
    getCollaterals(),
    getAuditLogs(9999),
  ])
  return { sources, parties, transactions: txns, collaterals, auditLogs, exportedAt: new Date().toISOString() }
}

export async function importAllData(data) {
  const db = getDb()
  for (const key of ['sources', 'parties', 'transactions', 'collaterals', 'auditLogs']) {
    const items = data[key] || []
    for (const item of items) {
      try {
        await db.put(item)
      } catch (e) {
        if (e.name === 'conflict') {
          const existing = await db.get(item._id)
          await db.put({ ...existing, ...item })
        }
      }
    }
  }
}
