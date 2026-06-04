import { renderHeader } from '../components/Header.js'
import { showToast } from '../components/Toast.js'
import { showConfirm, showPrompt } from '../components/Modal.js'
import { exportBackup, importBackup } from '../services/export.js'
import { isPinSet, setPin, verifyPin, clearPin } from '../services/pin.js'
import { getSettings, saveSettings, getAuditLogs, getMoneySources, getParties, getAllTransactions, getCollaterals } from '../db/database.js'
import { formatDateTime } from '../utils/formatters.js'

export async function renderSettings(container, navigate) {
  renderHeader('Settings')

  const hasPin = await isPinSet()
  const settings = await getSettings()

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Security</h3>
        <div class="space-y-2">
          <button class="w-full flex items-center justify-between px-3 py-3 rounded-xl hover:bg-gray-50" id="toggle-pin">
            <div class="flex items-center gap-3">
              <ion-icon name="lock-closed-outline" class="text-gray-400 text-lg"></ion-icon>
              <div class="text-left">
                <div class="text-sm font-medium">App Lock (PIN)</div>
                <div class="text-xs text-gray-400">${hasPin ? 'PIN is set' : 'No PIN configured'}</div>
              </div>
            </div>
            <div class="w-10 h-6 rounded-full ${hasPin ? 'bg-primary' : 'bg-gray-200'} relative transition-colors">
              <div class="w-4 h-4 bg-white rounded-full absolute top-1 ${hasPin ? 'right-1' : 'left-1'} shadow-sm transition-all"></div>
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
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Audit Log</h3>
        <div id="audit-log" class="space-y-1 max-h-48 overflow-y-auto"></div>
      </div>
    </div>
  `

  const [sources, parties, txns, collaterals] = await Promise.all([
    getMoneySources(), getParties(), getAllTransactions(), getCollaterals(),
  ])
  document.getElementById('data-count').textContent = (sources.length + parties.length + txns.length + collaterals.length) + ' records'

  const auditLogs = await getAuditLogs(20)
  const auditEl = document.getElementById('audit-log')
  if (auditLogs.length === 0) {
    auditEl.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No audit logs yet</p>'
  } else {
    auditEl.innerHTML = auditLogs.map((log) => `
      <div class="flex items-start gap-2 py-1.5 text-xs border-b border-gray-50 last:border-0">
        <span class="text-gray-400 shrink-0 w-16">${formatDateTime(log.timestamp).split(',')[0]}</span>
        <span class="capitalize text-gray-500 font-medium">${log.action}</span>
        <span class="text-gray-400 truncate">${log.details || log.entityType}</span>
      </div>
    `).join('')
  }

  document.getElementById('toggle-pin')?.addEventListener('click', async () => {
    const hasPinNow = await isPinSet()
    if (hasPinNow) {
      const confirmed = await showConfirm({ title: 'Remove PIN?', message: 'This will disable the app lock.', confirmText: 'Remove', danger: true })
      if (confirmed) {
        await clearPin()
        showToast('PIN removed')
        renderSettings(container, navigate)
      }
    } else {
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
}
