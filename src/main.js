import { registerRoute, initRouter } from './router.js'
import { renderDashboard } from './pages/Dashboard.js'
import { renderMoneySources } from './pages/MoneySources.js'
import { renderMoneySourceDetail } from './pages/MoneySourceDetail.js'
import { renderParties } from './pages/Parties.js'
import { renderPartyDetail } from './pages/PartyDetail.js'
import { renderSearch } from './pages/Search.js'
import { renderSettings } from './pages/Settings.js'
import { isLockEnabled, getLockMethod, authenticateWithWebAuthn, verifyPin } from './services/pin.js'
import { showToast } from './components/Toast.js'

registerRoute('dashboard', renderDashboard)
registerRoute('money-sources', renderMoneySources)
registerRoute('money-source-detail', renderMoneySourceDetail)
registerRoute('parties', renderParties)
registerRoute('party-detail', renderPartyDetail)
registerRoute('search', renderSearch)
registerRoute('settings', renderSettings)

async function init() {
  let exitConfirmed = false
  history.pushState(null, '', location.href)
  window.addEventListener('popstate', () => {
    if (exitConfirmed) return
    history.pushState(null, '', location.href)
    const ok = window.confirm('Are you sure you want to exit the app?')
    if (ok) {
      exitConfirmed = true
      history.back()
    }
  })
  window.addEventListener('beforeunload', (e) => {
    if (!exitConfirmed) {
      e.preventDefault()
      e.returnValue = ''
    }
  })

  const locked = await isLockEnabled()
  if (locked) {
    await showAuthLock()
  }

  initRouter()
}

async function showAuthLock() {
  const overlay = document.getElementById('pin-lock')
  overlay.classList.remove('hidden')

  const method = await getLockMethod()
  if (method === 'webauthn') {
    const ok = await authenticateWithWebAuthn()
    if (ok) {
      overlay.classList.add('hidden')
      return
    }
  }

  showPinPad(overlay)
}

function showPinPad(overlay) {
  overlay.innerHTML = `
    <div class="w-full max-w-xs px-6 text-center slide-up" id="pin-pad">
      <div class="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-primary to-vibgyor-violet rounded-2xl flex items-center justify-center">
        <ion-icon name="lock-closed-outline" class="text-3xl text-white"></ion-icon>
      </div>
      <h2 class="text-lg font-bold mb-1">App Locked</h2>
      <p class="text-sm text-gray-500 mb-6">Enter your PIN to access the app</p>
      <div class="flex justify-center gap-3 mb-4">
        ${[0, 1, 2, 3].map(() => '<div class="w-3 h-3 rounded-full bg-gray-200 pin-dot"></div>').join('')}
      </div>
      <div class="grid grid-cols-3 gap-3 max-w-[220px] mx-auto">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, 'del'].map((n) => n === '' ?
          '<div></div>' :
          `<button class="w-full aspect-square rounded-2xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-xl font-semibold flex items-center justify-center pin-btn" data-value="${n}">${n === 'del' ? '<ion-icon name="backspace-outline"></ion-icon>' : n}</button>`
        ).join('')}
      </div>
      <p class="text-xs text-red-500 mt-4 hidden" id="pin-error">Incorrect PIN</p>
    </div>
  `

  let enteredPin = ''
  const dots = overlay.querySelectorAll('.pin-dot')

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('.pin-btn')
    if (!btn) return
    const val = btn.dataset.value

    if (val === 'del') {
      enteredPin = enteredPin.slice(0, -1)
    } else if (val === '') {
      return
    } else {
      if (enteredPin.length >= 4) return
      enteredPin += val
    }

    dots.forEach((dot, i) => {
      dot.classList.toggle('bg-primary', i < enteredPin.length)
      dot.classList.toggle('bg-gray-200', i >= enteredPin.length)
    })

    if (enteredPin.length === 4) {
      verifyPin(enteredPin).then((valid) => {
        if (valid) {
          overlay.classList.add('hidden')
        } else {
          document.getElementById('pin-error').classList.remove('hidden')
          enteredPin = ''
          dots.forEach((dot) => { dot.classList.remove('bg-primary'); dot.classList.add('bg-gray-200') })
          setTimeout(() => document.getElementById('pin-error')?.classList.add('hidden'), 2000)
        }
      })
    }
  })
}

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => {
    console.error('SW registration failed:', err)
  })
}

// Force update helper — call from Settings to clear caches, unregister SW, and reload
window.forceSWUpdate = async function () {
  showToast('Refreshing app...')
  exitConfirmed = true
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map(k => caches.delete(k)))
  }
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg) await reg.unregister()
  }
  // Cache-bust the page URL only (not sw.js) so index.html is fetched fresh
  const base = location.href.split('?')[0].split('#')[0]
  setTimeout(() => { location.href = base + '?_t=' + Date.now() }, 300)
}

document.addEventListener('DOMContentLoaded', init)
