export function formatCurrency(n) {
  if (n == null || isNaN(n)) return '₹0'
  const num = Number(n)
  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)
  if (abs >= 10000000) return sign + '₹' + (abs / 10000000).toFixed(2) + 'Cr'
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(2) + 'L'
  return sign + '₹' + abs.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
}

export function formatCurrencyFull(n) {
  if (n == null || isNaN(n)) return '₹0.00'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

export function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return days + 'd ago'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function daysBetween(a, b) {
  const d1 = new Date(a)
  const d2 = new Date(b || new Date())
  return Math.max(0, Math.floor((d2 - d1) / 86400000))
}

export function riskColor(category) {
  const map = { low: 'badge-green', medium: 'badge-yellow', high: 'badge-red', critical: 'badge-red' }
  return map[category] || 'badge-gray'
}

export function sourceTypeIcon(type) {
  const map = { cash: 'cash-outline', bank: 'business-outline', partner: 'people-outline', other: 'ellipsis-horizontal-outline' }
  return map[type] || 'ellipsis-horizontal-outline'
}

export function collateralStatusColor(status) {
  const map = { held: 'badge-blue', partially_released: 'badge-yellow', released: 'badge-green' }
  return map[status] || 'badge-gray'
}

export function accountStatusColor(status) {
  const map = { active: 'badge-green', closed: 'badge-gray', defaulted: 'badge-red' }
  return map[status] || 'badge-gray'
}
