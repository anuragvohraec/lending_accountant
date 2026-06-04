import { getMoneySources, saveMoneySource, deleteMoneySource, getAllTransactions, addAuditLog } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, sourceTypeIcon } from '../utils/formatters.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { moneyIllustration, decorativeBg } from '../assets/vectors.js'

export async function renderMoneySources(container, navigate) {
  renderHeader('Money Sources')

  window.__sourceForm = () => showSourceForm(null, [], [], container)

  container.innerHTML = `
    <div id="sources-list" class="space-y-3 slide-up"></div>
    <button class="fab-btn fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-primary to-vibgyor-violet text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform" onclick="window.__sourceForm()">
      <span class="text-2xl font-bold leading-none">+</span>
    </button>
  `

  const removeLoader = showSkeleton(container.querySelector('#sources-list'))
  const [sources, allTxns] = await Promise.all([getMoneySources(), getAllTransactions()])
  removeLoader()
  renderSourceList(container, sources, allTxns, navigate)

  window.__sourceForm = () => showSourceForm(null, sources, allTxns, container)
}

function renderSourceList(container, sources, allTxns, navigate) {
  const el = document.getElementById('sources-list')
  if (sources.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        ${moneyIllustration()}
        <p class="font-medium text-gray-500 mb-1">No money sources yet</p>
        <p class="text-xs text-gray-400 mb-4">Tap + to add your first money source</p>
      </div>
    `
    return
  }

  const totalBalance = sources.reduce((s, src) => s + (src.currentBalance ?? src.openingBalance ?? 0), 0)
  const activeCount = sources.filter((s) => s.status !== 'inactive').length

  el.innerHTML = `
    <div class="card-flat flex items-center justify-between mb-1">
      <div>
        <div class="stat-value text-primary">${formatCurrency(totalBalance)}</div>
        <div class="stat-label">Total Balance (${activeCount} active)</div>
      </div>
    </div>
    ${sources.map((src) => {
      const balance = src.currentBalance ?? src.openingBalance ?? 0
      const lentOut = allTxns.filter((t) => {
        if (t.type !== 'debit') return false
        if (t.sourceAllocations) return t.sourceAllocations.some((a) => a.sourceId === src._id)
        return false
      }).reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === src._id)?.amount || 0), 0)

      return `
        <div class="card-flat ${src.status === 'inactive' ? 'opacity-60' : ''}">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-${src.type === 'cash' ? 'green' : src.type === 'bank' ? 'blue' : src.type === 'partner' ? 'purple' : 'gray'}-50 flex items-center justify-center text-${src.type === 'cash' ? 'green' : src.type === 'bank' ? 'blue' : src.type === 'partner' ? 'purple' : 'gray'}-600">
                <ion-icon name="${sourceTypeIcon(src.type)}" class="text-lg"></ion-icon>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate">${src.name}</div>
                <div class="text-xs text-gray-400 capitalize">${src.type}${src.owner ? ' · ' + src.owner : ''}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-mono font-bold text-sm">${formatCurrencyFull(balance)}</div>
              ${lentOut > 0 ? `<div class="text-xs text-amber-600">${formatCurrency(lentOut)} lent</div>` : ''}
            </div>
          </div>
          <div class="flex gap-2 mt-3 pt-3 border-t border-gray-50">
            <button class="text-xs text-primary font-medium flex-1 py-1.5 rounded-lg hover:bg-primary/5 edit-source" data-id="${src._id}">Edit</button>
            <button class="text-xs text-red-500 font-medium flex-1 py-1.5 rounded-lg hover:bg-red-50 delete-source" data-id="${src._id}">Delete</button>
          </div>
        </div>
      `
    }).join('')}
  `

  el.querySelectorAll('.edit-source').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = sources.find((s) => s._id === btn.dataset.id)
      showSourceForm(src, sources, allTxns, container)
    })
  })

  el.querySelectorAll('.delete-source').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({ title: 'Delete Source?', message: 'This will permanently remove this money source.', confirmText: 'Delete', danger: true })
      if (confirmed) {
        await deleteMoneySource(btn.dataset.id)
        logAction('delete', 'money_source', btn.dataset.id, 'Deleted money source')
        showToast('Source deleted')
        renderMoneySources(container, navigate)
      }
    })
  })
}

async function showSourceForm(editSource, sources, allTxns, container) {
  const isEdit = !!editSource
  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Account Name *</label>
        <input class="input" id="sf-name" value="${editSource?.name || ''}" placeholder="e.g. Main Cash" />
      </div>
      <div>
        <label class="input-label">Owner / Partner</label>
        <input class="input" id="sf-owner" value="${editSource?.owner || ''}" placeholder="Person or entity name" />
      </div>
      <div>
        <label class="input-label">Account Type *</label>
        <select class="input" id="sf-type">
          ${['cash', 'bank', 'partner', 'other'].map((t) =>
            `<option value="${t}" ${editSource?.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
          ).join('')}
        </select>
      </div>
      <div>
        <label class="input-label">Opening Balance *</label>
        <input class="input" id="sf-balance" type="number" step="0.01" value="${editSource?.openingBalance || editSource?.currentBalance || '0'}" />
      </div>
      <div>
        <label class="input-label">Status</label>
        <select class="input" id="sf-status">
          <option value="active" ${editSource?.status !== 'inactive' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${editSource?.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="sf-notes" rows="2" placeholder="Optional notes">${editSource?.notes || ''}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Source' : 'Add Source',
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onConfirm: () => {
      const name = document.getElementById('sf-name')?.value.trim()
      if (!name) { showToast('Account name is required', 'error'); return false }
      return {
        name,
        owner: document.getElementById('sf-owner')?.value.trim() || '',
        type: document.getElementById('sf-type')?.value || 'cash',
        openingBalance: parseFloat(document.getElementById('sf-balance')?.value) || 0,
        currentBalance: parseFloat(document.getElementById('sf-balance')?.value) || 0,
        status: document.getElementById('sf-status')?.value || 'active',
        notes: document.getElementById('sf-notes')?.value.trim() || '',
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  if (isEdit) result._id = editSource._id

  try {
    await saveMoneySource(result)
  } catch (err) {
    showToast('Error saving: ' + err.message, 'error')
    return
  }
  logAction(isEdit ? 'update' : 'create', 'money_source', result._id || '', isEdit ? 'Updated money source' : 'Created money source')
  showToast(isEdit ? 'Source updated' : 'Source added')
  renderMoneySources(container)
}
