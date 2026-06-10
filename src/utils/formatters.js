function roundToRupee(n) {
  return Math.round(Number(n))
}

export function formatCurrency(n) {
  if (n == null || isNaN(n)) return '₹0'
  const num = roundToRupee(n)
  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)
  if (abs >= 10000000) return sign + '₹' + (abs / 10000000).toFixed(1) + 'Cr'
  if (abs >= 100000) return sign + '₹' + (abs / 100000).toFixed(1) + 'L'
  return sign + '₹' + abs.toLocaleString('en-IN')
}

export function formatCurrencyFull(n) {
  if (n == null || isNaN(n)) return '₹0'
  const num = roundToRupee(n)
  const sign = num < 0 ? '-' : ''
  return sign + '₹' + Math.abs(num).toLocaleString('en-IN')
}

export function formatCurrencyPrecise(n) {
  if (n == null || isNaN(n)) return '₹0.00'
  const sign = Number(n) < 0 ? '-' : ''
  return sign + '₹' + Math.abs(Number(n)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toDDMMYY(d) {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

function toDDMMYYHHMM(d) {
  return toDDMMYY(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export function formatDate(dateStr) {
  if (!dateStr) return '-'
  return toDDMMYY(new Date(dateStr))
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-'
  return toDDMMYY(new Date(dateStr))
}

export function formatTimestamp(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const hrs = d.getHours()
  const mins = d.getMinutes().toString().padStart(2, '0')
  const ampm = hrs >= 12 ? 'PM' : 'AM'
  const h12 = hrs % 12 || 12
  return toDDMMYY(d) + ' ' + h12 + ':' + mins + ' ' + ampm
}

export function formatTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const hrs = d.getHours()
  const mins = d.getMinutes().toString().padStart(2, '0')
  const ampm = hrs >= 12 ? 'PM' : 'AM'
  const h12 = hrs % 12 || 12
  return h12 + ':' + mins + ' ' + ampm
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
  return toDDMMYY(d)
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
  const map = { held: 'badge-blue', released: 'badge-green' }
  return map[status] || 'badge-gray'
}

export function accountStatusColor(status) {
  const map = { active: 'badge-green', closed: 'badge-gray', defaulted: 'badge-red' }
  return map[status] || 'badge-gray'
}
