import { renderHeader } from '../components/Header.js'
import { showToast } from '../components/Toast.js'
import { showConfirm, showPrompt } from '../components/Modal.js'
import { exportBackup, importBackup } from '../services/export.js'
import { isLockEnabled, getLockMethod, webauthnAvailable, setupWebAuthn, setPin, clearAuth } from '../services/pin.js'
import { getSettings, saveSettings, getAuditLogs, getMoneySources, getParties, getAllTransactions, getAllSourceTransactions, getCollaterals, getLedgers, getAllAuditLogs } from '../db/database.js'

import { dateInputHTML, setupDateInput, getDateInputValue, setDateInputValue } from '../utils/dateInput.js'
import { startSync, stopSync, getSyncState, onSyncStatus, clearSyncListeners } from '../services/sync.js'

export async function renderSettings(container, navigate) {
  renderHeader('Settings')
  clearSyncListeners()

  const lockEnabled = await isLockEnabled()
  const lockMethod = await getLockMethod()
  const settings = await getSettings()
  const syncState = getSyncState()

  const lockStatus = lockMethod === 'webauthn' ? 'Biometric enabled' : lockMethod === 'pin' ? 'PIN configured' : 'No lock configured'

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Security</h3>
        <div class="space-y-2">
          <button class="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-gray-50" id="toggle-lock">
            <div class="flex items-center gap-3">
              <ion-icon name="lock-closed-outline" class="text-gray-400 text-lg"></ion-icon>
              <div class="text-left">
                <div class="text-sm font-medium">App Lock</div>
                <div class="text-xs text-gray-400">${lockStatus}</div>
              </div>
            </div>
            <div class="w-10 h-6 rounded-full ${lockEnabled ? 'bg-primary' : 'bg-gray-200'} relative transition-colors">
              <div class="w-4 h-4 bg-white rounded-full absolute top-1 ${lockEnabled ? 'right-1' : 'left-1'} shadow-sm transition-all"></div>
            </div>
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Data Management</h3>
        <div class="space-y-2">
          <button class="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50" id="export-backup">
            <ion-icon name="download-outline" class="text-gray-400 text-lg"></ion-icon>
            <div class="text-left">
              <div class="text-sm font-medium">Export Backup</div>
              <div class="text-xs text-gray-400">Download all data as JSON</div>
            </div>
          </button>
          <button class="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50" id="import-backup">
            <ion-icon name="cloud-upload-outline" class="text-gray-400 text-lg"></ion-icon>
            <div class="text-left">
              <div class="text-sm font-medium">Import Backup</div>
              <div class="text-xs text-gray-400">Restore from a backup file</div>
            </div>
          </button>
          ${settings.lastBackup ? `<div class="px-3 text-xs text-green-600 flex items-center gap-1"><ion-icon name="checkmark-circle-outline"></ion-icon> Last backup: ${formatDateTime(settings.lastBackup)}</div>` : ''}
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold text-sm mb-3">CouchDB Sync</h3>
        <div class="space-y-3">
          <div>
            <label class="input-label">Server URL</label>
            <div class="relative">
              <input class="input pr-20" id="couch-url" type="url" value="${settings.couchUrl || ''}" placeholder="http://192.168.1.100:5984" />
              <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button type="button" id="couch-url-clear" class="text-gray-400 hover:text-gray-600 p-1 ${settings.couchUrl ? '' : 'hidden'}" title="Clear">
                  <ion-icon name="close-circle-outline" class="text-lg"></ion-icon>
                </button>
                <button type="button" id="couch-url-qr" class="text-gray-400 hover:text-primary p-1" title="Scan QR Code">
                  <ion-icon name="qr-code-outline" class="text-lg"></ion-icon>
                </button>
              </div>
            </div>
          </div>
          <div>
            <label class="input-label">Database Name</label>
            <input class="input" id="couch-dbname" value="${settings.couchDbName || ''}" placeholder="my_database" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="input-label">Username</label>
              <input class="input" id="couch-user" value="${settings.couchUsername || ''}" placeholder="admin" />
            </div>
            <div>
              <label class="input-label">Password</label>
              <div class="relative">
                <input class="input pr-10" id="couch-pass" type="password" value="${settings.couchPassword || ''}" placeholder="••••••••" />
                <button type="button" id="toggle-pass" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabindex="-1">
                  <ion-icon name="eye-outline" class="text-lg"></ion-icon>
                </button>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3 pt-1">
            <button class="btn-primary flex-1 text-sm" id="save-couch">Save & Connect</button>
            <button class="${syncState.active ? 'btn-danger' : 'btn-outline'} text-sm" id="toggle-sync">${syncState.active ? 'Stop Sync' : 'Start Sync'}</button>
          </div>
          <div id="sync-status" class="text-xs text-gray-400 flex items-center gap-1 min-h-[1.25rem]"></div>
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold text-sm mb-3">About</h3>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between px-3 py-2">
            <span class="text-gray-500">Version</span>
            <span class="font-medium">1.0.0</span>
          </div>
          <div class="flex justify-between px-3 py-2">
            <span class="text-gray-500">Storage</span>
            <span class="font-medium">Local (IndexedDB)</span>
          </div>
          <div class="flex justify-between px-3 py-2">
            <span class="text-gray-500">Data entries</span>
            <span class="font-medium" id="data-count">Loading...</span>
          </div>
          <div class="flex justify-between px-3 py-2">
            <span class="text-gray-500">SW Cache</span>
            <span class="font-medium" id="sw-version">Loading...</span>
          </div>
          <button class="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50" id="force-update">
            <ion-icon name="refresh-outline" class="text-gray-400 text-lg"></ion-icon>
            <div class="text-left">
              <div class="text-sm font-medium">Update App</div>
              <div class="text-xs text-gray-400">Check and apply latest app update</div>
            </div>
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Audit Log</h3>
        <div class="flex items-center gap-1.5 mb-2">
          <button class="btn-ghost text-xs px-2 py-1" id="audit-prev-day"><ion-icon name="chevron-back-outline"></ion-icon></button>
          ${dateInputHTML({id: 'audit-date', value: new Date().toISOString().split('T')[0]})}
          <button class="btn-ghost text-xs px-2 py-1" id="audit-next-day"><ion-icon name="chevron-forward-outline"></ion-icon></button>
        </div>
        <div id="audit-log" class="space-y-1 max-h-48 overflow-y-auto"></div>
      </div>
    </div>
  `

  const [sources, parties, txns, collaterals, srcTxns, ledgers, allAuditLogs] = await Promise.all([
    getMoneySources(), getParties(), getAllTransactions(), getCollaterals(), getAllSourceTransactions(), getLedgers(), getAllAuditLogs(),
  ])
  document.getElementById('data-count').textContent = (sources.length + parties.length + txns.length + collaterals.length + srcTxns.length + ledgers.length + allAuditLogs.length) + ' records'

  ;(async () => {
    const el = document.getElementById('sw-version')
    if (!('serviceWorker' in navigator)) { el.textContent = 'N/A'; return }
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.active) { el.textContent = 'N/A'; return }
    const handler = (e) => {
      if (e.data?.type === 'VERSION') {
        navigator.serviceWorker.removeEventListener('message', handler)
        el.textContent = e.data.version
      }
    }
    navigator.serviceWorker.addEventListener('message', handler)
    reg.active.postMessage({ type: 'GET_VERSION' })
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', handler)
      if (el.textContent === 'Loading...') el.textContent = 'unknown'
    }, 2000)
  })()

  document.getElementById('force-update')?.addEventListener('click', () => {
    if (window.forceSWUpdate) window.forceSWUpdate()
  })

  setupDateInput('audit-date')

  async function renderAuditLogsForDate(dateStr) {
    const auditEl = document.getElementById('audit-log')
    if (!auditEl) return
    const dayStart = dateStr + 'T00:00:00'
    const dayEnd = dateStr + 'T23:59:59'
    const all = await getAllAuditLogs()
    let logs = all.filter(l => l.timestamp >= dayStart && l.timestamp <= dayEnd)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    auditEl.classList.remove('max-h-48')
    if (logs.length === 0) {
      auditEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No audit logs for this date</p>'
    } else {
      auditEl.innerHTML = logs.map((log) => {
        const d = new Date(log.timestamp)
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yy = String(d.getFullYear()).slice(-2)
        const hrs = String(d.getHours()).padStart(2, '0')
        const mins = String(d.getMinutes()).padStart(2, '0')
        const dateTimeStr = dd + '/' + mm + '/' + yy + ' ' + hrs + ':' + mins
        return `
        <div class="flex flex-col gap-0.5 py-1.5 text-xs border-b border-gray-50 last:border-0">
          <div class="flex items-center justify-between">
            <span class="text-gray-400">${dateTimeStr}</span>
            <span class="capitalize text-gray-500 font-medium">${log.action}</span>
          </div>
          <div class="text-gray-400 break-words whitespace-pre-wrap">${log.details || log.entityType}</div>
        </div>
      `}).join('')
    }
  }

  function getCurrentAuditDate() {
    return getDateInputValue('audit-date') || new Date().toISOString().split('T')[0]
  }

  function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00')
    d.setDate(d.getDate() + days)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }

  document.getElementById('audit-prev-day').addEventListener('click', () => {
    const newDate = shiftDate(getCurrentAuditDate(), -1)
    setDateInputValue('audit-date', newDate)
    renderAuditLogsForDate(newDate)
  })

  document.getElementById('audit-next-day').addEventListener('click', () => {
    const newDate = shiftDate(getCurrentAuditDate(), 1)
    setDateInputValue('audit-date', newDate)
    renderAuditLogsForDate(newDate)
  })

  document.getElementById('audit-date').addEventListener('change', () => {
    renderAuditLogsForDate(getCurrentAuditDate())
  })

  renderAuditLogsForDate(new Date().toISOString().split('T')[0])

  async function refreshDataAndAudit() {
    const dc = document.getElementById('data-count')
    if (!dc) return
    const [s, p, t, col, st, l, al] = await Promise.all([
      getMoneySources(), getParties(), getAllTransactions(), getCollaterals(), getAllSourceTransactions(), getLedgers(), getAllAuditLogs(),
    ])
    dc.textContent = (s.length + p.length + t.length + col.length + st.length + l.length + al.length) + ' records'
    renderAuditLogsForDate(getCurrentAuditDate())
  }

  document.getElementById('toggle-lock')?.addEventListener('click', async () => {
    const enabled = await isLockEnabled()
    if (enabled) {
      const confirmed = await showConfirm({ title: 'Remove App Lock?', message: 'This will disable the app lock.', confirmText: 'Remove', danger: true })
      if (confirmed) {
        await clearAuth()
        showToast('App lock removed')
        renderSettings(container, navigate)
      }
    } else {
      const webauthnOk = await webauthnAvailable()
      if (webauthnOk) {
        try {
          await setupWebAuthn()
          showToast('Biometric lock enabled')
          renderSettings(container, navigate)
          return
        } catch {
          // user cancelled or failed — fall through to PIN
        }
      }
      const pin = await showPrompt({ title: 'Set PIN', message: 'Enter a 4-digit PIN to lock the app', inputType: 'password', placeholder: '****', confirmText: 'Set' })
      if (pin && pin.length >= 4) {
        await setPin(pin)
        showToast('PIN set successfully')
        renderSettings(container, navigate)
      } else if (pin) {
        showToast('PIN must be at least 4 digits', 'error')
      }
    }
  })

  document.getElementById('export-backup')?.addEventListener('click', async () => {
    showToast('Exporting backup...', 'info')
    await exportBackup()
    showToast('Backup exported')
    renderSettings(container, navigate)
  })

  document.getElementById('import-backup')?.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      try {
        showToast('Importing backup...', 'info')
        const result = await importBackup(file)
        showToast(`Imported ${result.count} records`, 'success')
        renderSettings(container, navigate)
      } catch (err) {
        showToast(err.message, 'error')
      }
    }
    input.click()
  })

  const syncStatusEl = document.getElementById('sync-status')
  const toggleBtn = document.getElementById('toggle-sync')

  const syncMsg = (text, cls = 'text-gray-400') => { if (syncStatusEl) syncStatusEl.innerHTML = `<span class="${cls}">${text}</span>` }

  if (syncState.active) syncMsg('Sync is running...', 'text-green-600')

  const unsub = onSyncStatus((ev) => {
    if (ev.type === 'started') { syncMsg('Sync started', 'text-green-600'); toggleBtn.textContent = 'Stop Sync'; toggleBtn.className = 'btn-danger text-sm' }
    else if (ev.type === 'stopped') { syncMsg('Sync stopped', 'text-gray-400'); toggleBtn.textContent = 'Start Sync'; toggleBtn.className = 'btn-outline text-sm'; refreshDataAndAudit() }
    else if (ev.type === 'change') { syncMsg(`Synced ${ev.docs} doc(s) ${ev.dir}`, 'text-primary') }
    else if (ev.type === 'error') { syncMsg(`Error: ${ev.message}`, 'text-red-500'); refreshDataAndAudit() }
    else if (ev.type === 'paused') {
      if (ev.err) { syncMsg(`Paused: ${ev.err}`, 'text-amber-600') } else { syncMsg('Up to date', 'text-green-600'); refreshDataAndAudit() }
    }
    else if (ev.type === 'active') { syncMsg('Syncing...', 'text-primary') }
  })

  document.getElementById('couch-url')?.addEventListener('input', function () {
    const clearBtn = document.getElementById('couch-url-clear')
    if (clearBtn) clearBtn.classList.toggle('hidden', !this.value)
  })

  document.getElementById('couch-url-clear')?.addEventListener('click', () => {
    const input = document.getElementById('couch-url')
    if (input) { input.value = ''; input.focus() }
    document.getElementById('couch-url-clear')?.classList.add('hidden')
  })

  document.getElementById('couch-url-qr')?.addEventListener('click', showQRScanner)

  document.getElementById('save-couch')?.addEventListener('click', async () => {
    const url = document.getElementById('couch-url')?.value.trim()
    if (!url) { showToast('Server URL is required', 'error'); return }
    await saveSettings({
      couchUrl: url,
      couchDbName: document.getElementById('couch-dbname')?.value.trim() || '',
      couchUsername: document.getElementById('couch-user')?.value.trim() || '',
      couchPassword: document.getElementById('couch-pass')?.value || '',
    })
    showToast('Settings saved')
  })

  document.getElementById('toggle-pass')?.addEventListener('click', () => {
    const input = document.getElementById('couch-pass')
    const icon = document.querySelector('#toggle-pass ion-icon')
    if (input.type === 'password') {
      input.type = 'text'
      icon.name = 'eye-off-outline'
    } else {
      input.type = 'password'
      icon.name = 'eye-outline'
    }
  })

  toggleBtn?.addEventListener('click', async () => {
    const state = getSyncState()
    if (state.active) {
      stopSync()
    } else {
      try {
        await startSync()
      } catch (err) {
        showToast(err.message, 'error')
      }
    }
  })
}

function showQRScanner() {
  let stream = null
  let animId = null

  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4'
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
      <div class="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 class="text-sm font-semibold">Scan QR Code</h3>
        <button class="btn-ghost btn-icon text-gray-400" id="qr-close"><ion-icon name="close-outline" class="text-xl"></ion-icon></button>
      </div>
      <div class="p-4">
        <video id="qr-video" autoplay playsinline class="w-full aspect-square rounded-xl bg-black object-cover mb-3"></video>
        <canvas id="qr-canvas" class="hidden"></canvas>
        <p id="qr-status" class="text-xs text-gray-400 text-center">Point camera at a QR code</p>
        <div class="flex gap-2 mt-3">
          <button class="btn-outline btn-sm flex-1" id="qr-upload"><ion-icon name="image-outline" class="text-sm mr-1"></ion-icon>Upload Image</button>
        </div>
        <input type="file" accept="image/*" id="qr-file" class="hidden" />
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
      })
      const video = document.getElementById('qr-video')
      video.srcObject = stream
      await video.play()
      scanFrame()
    } catch {
      document.getElementById('qr-status').textContent = 'Camera unavailable. Upload a QR image instead.'
    }
  }

  function scanFrame() {
    const video = document.getElementById('qr-video')
    const canvas = document.getElementById('qr-canvas')
    if (!video || !canvas || video.readyState < 2) { animId = requestAnimationFrame(scanFrame); return }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (window.jsQR) {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        document.getElementById('qr-status').textContent = 'QR detected!'
        const input = document.getElementById('couch-url')
        if (input) input.value = code.data
        document.getElementById('couch-url-clear')?.classList.remove('hidden')
        setTimeout(() => { stopScanner(); overlay.remove() }, 300)
        return
      }
    }
    animId = requestAnimationFrame(scanFrame)
  }

  function stopScanner() {
    if (animId) { cancelAnimationFrame(animId); animId = null }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
  }

  overlay.querySelector('#qr-close').addEventListener('click', () => { stopScanner(); overlay.remove() })
  overlay.querySelector('#qr-upload').addEventListener('click', () => document.getElementById('qr-file')?.click())
  overlay.querySelector('#qr-file').addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    stopScanner()
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.getElementById('qr-canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        if (window.jsQR) {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height)
          if (code) {
            document.getElementById('qr-status').textContent = 'QR detected!'
            const input = document.getElementById('couch-url')
            if (input) input.value = code.data
            document.getElementById('couch-url-clear')?.classList.remove('hidden')
            setTimeout(() => overlay.remove(), 300)
          } else {
            document.getElementById('qr-status').textContent = 'No QR code found in the image'
          }
        } else {
          document.getElementById('qr-status').textContent = 'QR library not loaded'
        }
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
  })

  startCamera()
}
