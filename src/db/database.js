const DB_NAME = 'munimji'

let db

export function getDb() {
  if (!db) {
    db = new window.PouchDB(DB_NAME)
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

export async function getLedgers(partyId) {
  const all = await allDocs('ledger_')
  return partyId ? all.filter((l) => l.partyId === partyId) : all
}

export async function saveLedger(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'ledger_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteLedger(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function migrateLedgers(partyId) {
  const ledgers = await getLedgers(partyId)
  if (ledgers.length > 0) return
  const party = await getParty(partyId)
  const ledger = await saveLedger({
    partyId,
    name: 'Loan Account',
    status: party.status || 'active',
    interestRate: party.interestRate || 0,
    notes: 'Default ledger (auto-created)',
  })
  const db = getDb()
  const txns = await getTransactions(partyId)
  for (const t of txns) {
    t.ledgerId = ledger.id
    await db.put(t)
  }
  const colls = await getCollaterals(partyId)
  for (const c of colls) {
    c.ledgerId = ledger.id
    await db.put(c)
  }
}

export async function getTransactions(partyId, ledgerId, category) {
  const all = await allDocs('txn_')
  let filtered = all.slice()
  if (partyId) filtered = filtered.filter((t) => t.partyId === partyId)
  if (ledgerId) filtered = filtered.filter((t) => t.ledgerId === ledgerId)
  if (category) filtered = filtered.filter((t) => t.category === category)
  return filtered.sort((a, b) => new Date(b.date) - new Date(a.date))
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

export async function getCollaterals(partyId, ledgerId) {
  const all = await allDocs('collateral_')
  let filtered = all
  if (partyId) filtered = filtered.filter((c) => c.partyId === partyId)
  if (ledgerId) filtered = filtered.filter((c) => c.ledgerId === ledgerId)
  return filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
}

export async function saveCollateral(data) {
  const db = getDb()
  const imageFile = data._imageFile
  delete data._imageFile
  delete data.image

  let result, existing
  if (data._id) {
    existing = await db.get(data._id)
    delete existing.image
    result = await db.put({ ...existing, ...data })
  } else {
    data._id = 'collateral_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    data.dateAdded = new Date().toISOString()
    result = await db.put(data)
  }

  if (imageFile) {
    await db.putAttachment(result.id, 'image', result.rev, imageFile, imageFile.type)
  } else if (existing?.image) {
    const mime = existing.image.split(';')[0].split(':')[1] || 'image/jpeg'
    const raw = existing.image.split(',')[1]
    await db.putAttachment(result.id, 'image', result.rev, raw, mime)
  }

  return result
}

export async function deleteCollateral(id) {
  const db = getDb()
  const doc = await db.get(id)
  if (doc._attachments?.image) {
    const { rev } = await db.removeAttachment(id, 'image', doc._rev)
    return db.remove({ _id: id, _rev: rev })
  }
  return db.remove(doc)
}

export async function getCollateralImageDataUrl(id) {
  const db = getDb()
  try {
    const blob = await db.getAttachment(id, 'image')
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function getCollateralsWithAttachments() {
  const result = await getDb().allDocs({
    startkey: 'collateral_',
    endkey: 'collateral_\uffff',
    include_docs: true,
    attachments: true,
  })
  return result.rows.map((r) => r.doc).filter((d) => !d._deleted).sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
}

export async function getSourceTransactions(sourceId) {
  const all = await allDocs('srctxn_')
  let filtered = sourceId ? all.filter((t) => t.sourceId === sourceId) : all
  return filtered.sort((a, b) => new Date(a.date) - new Date(b.date))
}

export async function getAllSourceTransactions() {
  return allDocs('srctxn_')
}

export async function saveSourceTransaction(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data })
  }
  data._id = 'srctxn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  return db.put(data)
}

export async function deleteSourceTransaction(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function saveSourceTransfer({ fromSourceId, toSourceId, amount, date, notes, sourceNames }) {
  const db = getDb()
  const transferPairId = 'transfer_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const now = new Date().toISOString()

  const fromTxn = {
    _id: 'srctxn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sourceId: fromSourceId,
    type: 'debit',
    amount,
    date,
    category: 'transfer',
    transferPairId,
    pairSourceId: toSourceId,
    description: `Transferred to ${sourceNames?.to || 'Unknown'}`,
    notes: notes || '',
    createdAt: now,
  }
  const toTxn = {
    _id: 'srctxn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    sourceId: toSourceId,
    type: 'credit',
    amount,
    date,
    category: 'transfer',
    transferPairId,
    pairSourceId: fromSourceId,
    description: `Transferred from ${sourceNames?.from || 'Unknown'}`,
    notes: notes || '',
    createdAt: now,
  }
  return Promise.all([db.put(fromTxn), db.put(toTxn)])
}

export async function getAllAuditLogs() {
  return allDocs('audit_')
}

export async function getAuditLogs(limit = 50) {
  const all = await getAllAuditLogs()
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
    return { _id: 'app_settings', pin: '', webauthnCredentialId: null, webauthnRpId: null, backupReminder: true, lastBackup: null }
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
    getCollateralsWithAttachments(),
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

export async function getAllTodos() {
  return allDocs('todo_')
}

export async function saveTodo(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    data._rev = existing._rev
    return db.put({ ...existing, ...data })
  }
  data._id = 'todo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  return db.put(data)
}

export async function deleteTodo(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getPendingTodoCount() {
  const all = await getAllTodos()
  return all.filter(t => t.status !== 'closed').length
}
