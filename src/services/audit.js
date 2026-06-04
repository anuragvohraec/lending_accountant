import { addAuditLog } from '../db/database.js'

export function logAction(action, entityType, entityId, details = '') {
  addAuditLog(action, entityType, entityId, details).catch(console.error)
}
