import { registerRoute, initRouter } from './router.js'
import { renderDashboard } from './pages/Dashboard.js'
import { renderMoneySources } from './pages/MoneySources.js'
import { renderMoneySourceDetail } from './pages/MoneySourceDetail.js'
import { renderParties } from './pages/Parties.js'
import { renderPartyDetail } from './pages/PartyDetail.js'
import { renderSearch } from './pages/Search.js'
import { renderSettings } from './pages/Settings.js'
import { isPinSet, verifyPin } from './services/pin.js'

registerRoute('dashboard', renderDashboard)
registerRoute('money-sources', renderMoneySources)
registerRoute('money-source-detail', renderMoneySourceDetail)
registerRoute('parties', renderParties)
registerRoute('party-detail', renderPartyDetail)
registerRoute('search', renderSearch)
registerRoute('settings', renderSettings)

async function init() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try {
      await navigator.serviceWorker.register('/sw.js')
    } catch (e) {
      console.warn('SW registration failed:', e)
    }
  }

  const hasPin = await isPinSet()
  if (hasPin) {
    await showPinLock()
  }

  initRouter()
}

async function showPinLock() {
  const overlay = document.getElementById('pin-lock')
  overlay.classList.remove('hidden')
  overlay.innerHTML = `
    <div class="w-full max-w-xs px-6 text-center slide-up">
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

document.addEventListener('DOMContentLoaded', init)
