export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function today() {
  return new Date().toISOString().split('T')[0]
}

export function now() {
  return new Date().toISOString()
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function debounce(fn, ms = 300) {
  let t
  return (...a) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

export function pluralize(n, s, p) {
  return n === 1 ? s : p || s + 's'
}

export function truncate(str, len = 50) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

export function escHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function sanitize(str) {
  if (!str) return ''
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}
