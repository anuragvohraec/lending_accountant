import { getDb } from '../db/database.js'
import { getSettings } from '../db/database.js'

let syncHandler = null
let statusListeners = []

export function getSyncState() {
  return { active: syncHandler !== null }
}

export function clearSyncListeners() {
  statusListeners = []
}

export function onSyncStatus(fn) {
  statusListeners.push(fn)
  return () => { statusListeners = statusListeners.filter((f) => f !== fn) }
}

function notify(ev) {
  statusListeners.forEach((fn) => fn(ev))
}

export async function startSync() {
  const settings = await getSettings()
  if (!settings.couchUrl) throw new Error('CouchDB URL not configured')

  stopSync()

  const db = getDb()
  const options = { live: true, retry: true }

  if (settings.couchUsername && settings.couchPassword) {
    options.auth = { username: settings.couchUsername, password: settings.couchPassword }
  }

  const finalUrl = settings.couchUrl.replace(/\/+$/, '') + (settings.couchDbName ? '/' + settings.couchDbName : '')
  syncHandler = db.sync(finalUrl, options)

  syncHandler.on('change', (info) => notify({ type: 'change', dir: info.direction, docs: info.change.docs.length }))
  syncHandler.on('paused', (err) => notify({ type: 'paused', err: err ? err.message : null }))
  syncHandler.on('active', () => notify({ type: 'active' }))
  syncHandler.on('error', (err) => notify({ type: 'error', message: err.message }))
  syncHandler.on('complete', () => notify({ type: 'complete' }))

  notify({ type: 'started' })
}

export function stopSync() {
  if (syncHandler) {
    syncHandler.cancel()
    syncHandler = null
  }
  notify({ type: 'stopped' })
}
