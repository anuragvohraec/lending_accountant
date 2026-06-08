import { getMoneySources, saveMoneySource, deleteMoneySource, getAllTransactions, getAllSourceTransactions, addAuditLog, saveSourceTransfer } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, sourceTypeIcon } from '../utils/formatters.js'
import { dateInputHTML, setupDateInput, getDateInputValue } from '../utils/dateInput.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { moneyIllustration, decorativeBg } from '../assets/vectors.js'
import { escHtml } from '../utils/helpers.js'

export async function renderMoneySources(container, navigate) {
  renderHeader('Money Sources', {
    rightAction: `<div class="relative" id="source-menu-wrap">
      <button class="btn-ghost btn-icon" id="source-menu-btn"><ion-icon name="ellipsis-vertical-outline" class="text-xl"></ion-icon></button>
      <div id="source-dropdown" class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 min-w-[170px]">
        <button class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2" id="source-transfer-btn">
          <ion-icon name="swap-horizontal-outline" class="text-base text-gray-500"></ion-icon> Transfer Money
        </button>
      </div>
    </div>`
  })

  window.__sourceForm = () => showSourceForm(null, [], [], container)

  container.innerHTML = `
    <div id="sources-list" class="space-y-3 slide-up"></div>
    <button class="fab-btn fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-primary to-vibgyor-violet text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform" onclick="window.__sourceForm()">
      <span class="text-2xl font-bold leading-none">+</span>
    </button>
  `

  const removeLoader = showSkeleton(container.querySelector('#sources-list'))
  const [sources, allTxns, allSrcTxns] = await Promise.all([getMoneySources(), getAllTransactions(), getAllSourceTransactions()])
  removeLoader()

  const balances = {}
  for (const src of sources) {
    const srcTxns = allSrcTxns.filter((t) => t.sourceId === src._id)
    const principalTxns = allTxns.filter((t) => {
      if (!t.sourceAllocations || t.category === 'interest') return false
      return t.sourceAllocations.some((a) => a.sourceId === src._id)
    })
    const credits = srcTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
    const debits = srcTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
    const loansGiven = principalTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === src._id)?.amount || 0), 0)
    const repayments = principalTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === src._id)?.amount || 0), 0)
    balances[src._id] = (src.openingBalance || 0) + credits - debits - loansGiven + repayments
  }

  renderSourceList(container, sources, allTxns, balances, navigate)

  setupHeaderMenu(sources, container, navigate)

  window.__sourceForm = () => showSourceForm(null, sources, allTxns, container)
}

function setupHeaderMenu(sources, container, navigate) {
  const menuBtn = document.getElementById('source-menu-btn')
  const dropdown = document.getElementById('source-dropdown')
  if (!menuBtn || !dropdown) return

  function toggleMenu(e) {
    e.stopPropagation()
    dropdown.classList.toggle('hidden')
  }

  menuBtn.addEventListener('click', toggleMenu)

  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('hidden') && !menuBtn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden')
    }
  })

  document.getElementById('source-transfer-btn')?.addEventListener('click', async () => {
    dropdown.classList.add('hidden')
    showTransferForm(sources, null, container, navigate)
  })
}

async function showTransferForm(sources, presetSourceId, container, navigate) {
  const fromSources = sources.filter((s) => s.status !== 'inactive')
  const presetSource = presetSourceId ? sources.find((s) => s._id === presetSourceId) : null

  const fromOpts = fromSources.map((s) =>
    `<option value="${s._id}" ${presetSourceId === s._id ? 'selected' : ''}>${escHtml(s.name)}${s.owner ? ' (' + escHtml(s.owner) + ')' : ''}</option>`
  ).join('')

  const toOpts = fromSources.map((s) =>
    `<option value="${s._id}" ${presetSourceId !== s._id ? '' : 'disabled'}>${escHtml(s.name)}${s.owner ? ' (' + escHtml(s.owner) + ')' : ''}</option>`
  ).join('')

  const content = `
    <div class="space-y-3">
      ${presetSource ? `<p class="text-sm font-semibold text-gray-600">From: ${escHtml(presetSource.name)}</p>` : `
      <div>
        <label class="input-label">From Source *</label>
        <select class="input" id="tf-from">${fromOpts}</select>
      </div>`}
      <div>
        <label class="input-label">To Source *</label>
        <select class="input" id="tf-to">${toOpts}</select>
      </div>
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="tf-amount" type="number" step="0.01" placeholder="0.00" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        ${dateInputHTML({id: 'tf-date', value: new Date().toISOString().split('T')[0]})}
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="tf-notes" rows="2" placeholder="Optional reference"></textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Transfer Money',
    content,
    confirmText: 'Transfer',
    onMounted: () => {
      setupDateInput('tf-date')
      const fromEl = document.getElementById('tf-from')
      const toEl = document.getElementById('tf-to')
      if (fromEl && toEl) {
        fromEl.addEventListener('change', () => {
          const disabledVal = fromEl.value
          Array.from(toEl.options).forEach((opt) => {
            opt.disabled = opt.value === disabledVal
            if (opt.disabled && opt.selected) opt.selected = false
          })
        })
      }
    },
    onConfirm: () => {
      const fromId = presetSourceId || document.getElementById('tf-from')?.value
      const toId = document.getElementById('tf-to')?.value
      const amount = parseFloat(document.getElementById('tf-amount')?.value)
      const date = getDateInputValue('tf-date')
      const notes = document.getElementById('tf-notes')?.value.trim() || ''

      if (!fromId) { showToast('Select source', 'error'); return false }
      if (!toId) { showToast('Select target source', 'error'); return false }
      if (fromId === toId) { showToast('Cannot transfer to same source', 'error'); return false }
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }
      if (!date) { showToast('Select date', 'error'); return false }

      const fromSrc = sources.find((s) => s._id === fromId)
      const toSrc = sources.find((s) => s._id === toId)

      return {
        fromSourceId: fromId,
        toSourceId: toId,
        amount,
        date,
        notes,
        sourceNames: { from: fromSrc?.name || '', to: toSrc?.name || '' },
      }
    },
  })

  if (!result || result === true) return

  try {
    await saveSourceTransfer(result)
    logAction('create', 'source_transfer', '', `Transferred ${result.amount} from ${result.sourceNames.from} to ${result.sourceNames.to}`)
    showToast('Transfer recorded')
    if (navigate) navigate('money-sources')
    else renderMoneySources(container)
  } catch (err) {
    showToast('Error recording transfer: ' + err.message, 'error')
  }
}

function renderSourceList(container, sources, allTxns, balances, navigate) {
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

  const totalBalance = Object.values(balances).reduce((s, b) => s + b, 0)
  const activeCount = sources.filter((s) => s.status !== 'inactive').length

  const partnerBalances = {}
  for (const src of sources) {
    const key = src.owner || 'Unassigned'
    partnerBalances[key] = (partnerBalances[key] || 0) + (balances[src._id] ?? 0)
  }

  el.innerHTML = `
    <div class="card-flat flex items-center justify-between mb-1">
      <div>
        <div class="stat-value text-primary">${formatCurrency(totalBalance)}</div>
        <div class="stat-label">Current Balance (${activeCount} active)</div>
      </div>
    </div>
    <div class="card-flat !bg-gradient-to-br !from-indigo-50/50 !to-purple-50/50 mb-3">
      <h3 class="font-semibold text-sm mb-2">Partner-wise Balances</h3>
      ${Object.entries(partnerBalances).map(([partner, amt]) => `
        <div class="flex items-center justify-between py-1.5">
          <span class="text-sm">${partner}</span>
          <span class="font-mono font-semibold text-sm">${formatCurrencyFull(amt)}</span>
        </div>
      `).join('')}
    </div>
    ${sources.map((src) => {
      const balance = balances[src._id] ?? 0

      return `
        <div class="card-flat source-card ${src.status === 'inactive' ? 'opacity-60' : ''}" data-id="${src._id}">
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

  el.querySelectorAll('.source-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.edit-source') || e.target.closest('.delete-source')) return
      navigate('money-source-detail', { id: card.dataset.id })
    })
  })

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
        <label class="input-label">Current Balance *</label>
        <input class="input" id="sf-balance" type="number" step="0.01" value="${editSource?.currentBalance ?? editSource?.openingBalance ?? '0'}" />
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
        <textarea class="input" id="sf-notes" rows="3" placeholder="Optional notes">${escHtml(editSource?.notes || '')}</textarea>
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
