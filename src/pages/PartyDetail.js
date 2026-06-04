import { getParty, saveParty, deleteParty, getMoneySources, getTransactions, saveTransaction, deleteTransaction, getCollaterals, saveCollateral, deleteCollateral } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime, accountStatusColor, riskColor, collateralStatusColor } from '../utils/formatters.js'
import { calculateInterest, getOutstandingForParty, getSourceWiseOutstanding } from '../services/interest.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm, showPrompt } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'

export async function renderPartyDetail(container, navigate, params) {
  const removeLoader = showSkeleton(container)
  const [party, sources, allTxns, collaterals] = await Promise.all([
    getParty(params.id), getMoneySources(), getTransactions(params.id), getCollaterals(params.id),
  ])
  removeLoader()

  if (!party) {
    container.innerHTML = '<div class="empty-state"><p>Party not found</p></div>'
    return
  }

  const activeSources = sources.filter((s) => s.status !== 'inactive')
  const outstanding = getOutstandingForParty(allTxns)
  const totalDebit = allTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
  const totalCredit = allTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const heldCollateral = collaterals.filter((c) => c.status === 'held')
  const securityValue = heldCollateral.reduce((s, c) => s + (c.estimatedValue || 0), 0)
  const ltvRatio = outstanding > 0 && securityValue > 0 ? ((outstanding / securityValue) * 100).toFixed(1) : 'N/A'

  renderHeader(party.name, {
    onBack: () => navigate('parties'),
    rightAction: `<button class="btn-ghost btn-icon" id="party-menu"><ion-icon name="ellipsis-vertical-outline" class="text-xl"></ion-icon></button>`,
  })

  document.getElementById('party-menu')?.addEventListener('click', () => showPartyMenu(party, allTxns, sources, container, navigate))

  window.__txnForm = () => showTransactionForm(null, party, sources, allTxns, container, navigate)

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div class="card-flat">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-primary/10 to-vibgyor-violet/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
            ${(party.name || '?').charAt(0).toUpperCase()}
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="font-bold">${party.name}</span>
              <span class="${accountStatusColor(party.status)}">${party.status}</span>
            </div>
            ${party.phone ? `<div class="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><ion-icon name="call-outline" class="text-sm"></ion-icon>${party.phone}</div>` : ''}
          </div>
        </div>
        ${party.address ? `<p class="text-xs text-gray-400 flex items-start gap-1"><ion-icon name="location-outline" class="text-sm mt-0.5 shrink-0"></ion-icon>${party.address}</p>` : ''}
        ${party.notes ? `<p class="text-xs text-gray-500 mt-1">${party.notes}</p>` : ''}
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div class="card-flat text-center">
          <div class="stat-value text-red-500">${formatCurrency(totalDebit)}</div>
          <div class="stat-label">Total Given</div>
        </div>
        <div class="card-flat text-center">
          <div class="stat-value text-green-500">${formatCurrency(totalCredit)}</div>
          <div class="stat-label">Total Returned</div>
        </div>
        <div class="card-flat text-center">
          <div class="stat-value ${outstanding > 0 ? 'text-orange-500' : 'text-green-500'}">${formatCurrency(Math.abs(outstanding))}</div>
          <div class="stat-label">${outstanding > 0 ? 'Outstanding' : 'Settled'}</div>
        </div>
        <div class="card-flat text-center">
          <div class="stat-value text-vibgyor-violet">${formatCurrency(securityValue)}</div>
          <div class="stat-label">Security</div>
        </div>
      </div>

      ${party.interestRate > 0 ? `
        <div id="interest-section" class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-sm">Interest Summary</h3>
            <span class="badge-blue">${party.interestRate}%/mo</span>
          </div>
          <div id="interest-details"></div>
        </div>
      ` : ''}

      <div id="source-allocation" class="card">
        <h3 class="font-semibold text-sm mb-3">Source-wise Outstanding</h3>
        <div id="source-outstanding-list"></div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Collateral (${collaterals.length})</h3>
          <button class="text-xs text-primary font-medium" id="add-collateral-btn">+ Add</button>
        </div>
        <div id="collateral-list"></div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Transaction History (${allTxns.length})</h3>
        </div>
        <div id="txn-list"></div>
      </div>
    </div>
    <button class="fab-btn fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-primary to-vibgyor-violet text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform" onclick="window.__txnForm()">
      <span class="text-2xl font-bold leading-none">+</span>
    </button>
  `

  if (party.interestRate > 0) renderInterestSummary(allTxns, party)
  renderSourceOutstanding(allTxns, sources)
  renderCollateralList(collaterals, party, allTxns, sources, container, navigate)
  renderTransactionList(allTxns, sources, party, container, navigate)

  document.getElementById('add-collateral-btn')?.addEventListener('click', () => showCollateralForm(null, party._id, collaterals, party, allTxns, sources, container, navigate))
}

function renderInterestSummary(allTxns, party) {
  const el = document.getElementById('interest-details')
  const outstanding = getOutstandingForParty(allTxns)
  const asOfDate = new Date().toISOString().split('T')[0]
  const interest = calculateInterest({
    principal: Math.max(0, outstanding),
    rate: party.interestRate,
    fromDate: party.createdAt?.split('T')[0] || asOfDate,
    toDate: asOfDate,
  })

  el.innerHTML = `
    <div class="flex items-center justify-between py-1.5">
      <span class="text-sm text-gray-500">Principal</span>
      <span class="font-mono font-semibold text-sm">${formatCurrencyFull(outstanding)}</span>
    </div>
    <div class="flex items-center justify-between py-1.5">
      <span class="text-sm text-gray-500">Interest (${interest.days}d)</span>
      <span class="font-mono font-semibold text-sm text-amber-600">${formatCurrencyFull(interest.interest)}</span>
    </div>
    <div class="flex items-center justify-between py-1.5 border-t border-gray-100 mt-1.5 pt-2">
      <span class="text-sm font-semibold">Total Payable</span>
      <span class="font-mono font-bold text-sm text-red-500">${formatCurrencyFull(interest.total)}</span>
    </div>
  `
}

function renderSourceOutstanding(allTxns, sources) {
  const el = document.getElementById('source-outstanding-list')
  const sourceWise = getSourceWiseOutstanding(allTxns)
  const entries = Object.entries(sourceWise)

  if (entries.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No source allocations</p>'
    return
  }

  el.innerHTML = entries.map(([sourceId, amount]) => {
    const source = sources.find((s) => s._id === sourceId)
    return `
      <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
        <span class="text-sm">${source?.name || 'Unknown source'}</span>
        <span class="${amount > 0 ? 'amount-negative' : 'amount-neutral'} text-sm">${formatCurrencyFull(amount)}</span>
      </div>
    `
  }).join('')
}

function renderCollateralList(collaterals, party, allTxns, sources, container, navigate) {
  const el = document.getElementById('collateral-list')
  if (collaterals.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No collateral items</p>'
    return
  }

  el.innerHTML = collaterals.map((c) => `
    <div class="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <ion-icon name="${c.type === 'gold' ? 'diamond-outline' : c.type === 'electronics' ? 'laptop-outline' : c.type === 'vehicle' ? 'car-outline' : c.type === 'document' ? 'document-text-outline' : 'cube-outline'}" class="text-gray-400 text-lg"></ion-icon>
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">${c.description || c.type}</div>
          <div class="text-xs text-gray-400 flex items-center gap-2">
            <span class="${collateralStatusColor(c.status)}">${c.status.replace('_', ' ')}</span>
            ${c.serialNumber ? `<span>· ${c.serialNumber}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="text-right">
        <div class="font-mono font-semibold text-sm">${formatCurrencyFull(c.estimatedValue || 0)}</div>
      </div>
    </div>
  `).join('')
}

function renderTransactionList(allTxns, sources, party, container, navigate) {
  const el = document.getElementById('txn-list')
  if (allTxns.length === 0) {
    el.innerHTML = '<div class="empty-state"><ion-icon name="receipt-outline"></ion-icon><p class="text-xs text-gray-400">No transactions yet</p></div>'
    return
  }

  let runningBalance = 0
  const sorted = [...allTxns].sort((a, b) => new Date(a.date) - new Date(b.date))

  el.innerHTML = sorted.map((t) => {
    runningBalance += t.type === 'debit' ? t.amount : -t.amount
    const sourceNames = t.sourceAllocations?.map((a) => sources.find((s) => s._id === a.sourceId)?.name || 'Unknown').join(', ') || ''
    return `
      <div class="flex items-start justify-between py-3 border-b border-gray-50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${t.type === 'debit' ? 'bg-red-400' : 'bg-green-400'} shrink-0"></span>
            <span class="text-sm font-medium">${t.type === 'debit' ? 'Given' : 'Returned'}</span>
            ${t.tags ? t.tags.split(',').map((tag) => `<span class="badge-gray text-[10px]">${tag.trim()}</span>`).join('') : ''}
          </div>
          <div class="text-xs text-gray-400 mt-0.5">${formatDateTime(t.date)}</div>
          ${t.notes ? `<div class="text-xs text-gray-500 mt-0.5 truncate">${t.notes}</div>` : ''}
          ${sourceNames ? `<div class="text-xs text-gray-400 mt-0.5">From: ${sourceNames}</div>` : ''}
        </div>
        <div class="text-right ml-3">
          <div class="${t.type === 'debit' ? 'amount-negative' : 'amount-positive'} text-sm">${t.type === 'debit' ? '-' : '+'}${formatCurrencyFull(t.amount)}</div>
          <div class="text-xs font-mono text-gray-400">${formatCurrencyFull(runningBalance)}</div>
        </div>
      </div>
    `
  }).join('')
}

async function showTransactionForm(editTxn, party, sources, allTxns, container, navigate) {
  const isEdit = !!editTxn
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  const sourceAllocHtml = activeSources.length > 0 ? `
    <div>
      <label class="input-label">Money Source Allocation</label>
      <div class="space-y-2" id="source-allocs">
        ${activeSources.map((s, i) => `
          <div class="flex items-center gap-2">
            <input type="checkbox" id="alloc-src-${s._id}" class="rounded border-gray-300 text-primary focus:ring-primary src-check" data-id="${s._id}" ${i === 0 ? 'checked' : ''} />
            <label for="alloc-src-${s._id}" class="text-sm flex-1">${s.name}</label>
            <input type="number" step="0.01" class="input w-28 text-sm alloc-amount" data-id="${s._id}" placeholder="Amount" ${i === 0 ? '' : 'disabled'} />
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''

  const content = `
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Type *</label>
          <select class="input" id="txn-type">
            <option value="debit" ${editTxn?.type === 'debit' ? 'selected' : ''}>Debit (Give)</option>
            <option value="credit" ${editTxn?.type === 'credit' ? 'selected' : ''}>Credit (Return)</option>
          </select>
        </div>
        <div>
          <label class="input-label">Amount *</label>
          <input class="input" id="txn-amount" type="number" step="0.01" value="${editTxn?.amount || ''}" placeholder="0.00" />
        </div>
      </div>
      <div>
        <label class="input-label">Date & Time</label>
        <input class="input" id="txn-date" type="date" value="${editTxn?.date?.split('T')[0] || new Date().toISOString().split('T')[0]}" />
      </div>
      ${sourceAllocHtml}
      <div>
        <label class="input-label">Tags (comma separated)</label>
        <input class="input" id="txn-tags" value="${editTxn?.tags || ''}" placeholder="e.g. urgent, monthly" />
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="txn-notes" rows="2" placeholder="Transaction notes">${editTxn?.notes || ''}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Transaction' : 'New Transaction',
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onMounted: () => {
      document.getElementById('source-allocs')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('src-check')) {
          const input = document.querySelector(`.alloc-amount[data-id="${e.target.dataset.id}"]`)
          if (input) input.disabled = !e.target.checked
        }
      })
    },
    onConfirm: () => {
      const amount = parseFloat(document.getElementById('txn-amount')?.value)
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }

      const sourceAllocations = []
      document.querySelectorAll('.src-check:checked').forEach((cb) => {
        const input = document.querySelector(`.alloc-amount[data-id="${cb.dataset.id}"]`)
        const val = parseFloat(input?.value) || 0
        if (val > 0) sourceAllocations.push({ sourceId: cb.dataset.id, amount: val })
      })

      return {
        partyId: party._id,
        type: document.getElementById('txn-type')?.value || 'debit',
        amount,
        date: document.getElementById('txn-date')?.value || new Date().toISOString(),
        tags: document.getElementById('txn-tags')?.value.trim() || '',
        notes: document.getElementById('txn-notes')?.value.trim() || '',
        sourceAllocations: sourceAllocations.length > 0 ? sourceAllocations : undefined,
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  if (isEdit) result._id = editTxn._id

  await saveTransaction(result)
  logAction(isEdit ? 'update' : 'create', 'transaction', result._id || '', `${isEdit ? 'Updated' : 'Added'} ${result.type} transaction of ${result.amount}`)
  showToast(isEdit ? 'Transaction updated' : 'Transaction added')
  renderPartyDetail(container, navigate, { id: party._id })
}

async function showCollateralForm(editCollateral, partyId, collaterals, party, allTxns, sources, container, navigate) {
  const isEdit = !!editCollateral
  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Type *</label>
        <select class="input" id="col-type">
          ${['gold', 'electronics', 'vehicle', 'document', 'other'].map((t) =>
            `<option value="${t}" ${editCollateral?.type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
          ).join('')}
        </select>
      </div>
      <div>
        <label class="input-label">Description *</label>
        <input class="input" id="col-desc" value="${editCollateral?.description || ''}" placeholder="Item description" />
      </div>
      <div>
        <label class="input-label">Serial Number</label>
        <input class="input" id="col-serial" value="${editCollateral?.serialNumber || ''}" placeholder="Serial / ID number" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Weight / Qty</label>
          <input class="input" id="col-weight" value="${editCollateral?.weight || ''}" placeholder="e.g. 20g" />
        </div>
        <div>
          <label class="input-label">Estimated Value *</label>
          <input class="input" id="col-value" type="number" step="0.01" value="${editCollateral?.estimatedValue || ''}" placeholder="0.00" />
        </div>
      </div>
      <div>
        <label class="input-label">Status</label>
        <select class="input" id="col-status">
          <option value="held" ${editCollateral?.status === 'held' || !editCollateral ? 'selected' : ''}>Held</option>
          <option value="partially_released" ${editCollateral?.status === 'partially_released' ? 'selected' : ''}>Partially Released</option>
          <option value="released" ${editCollateral?.status === 'released' ? 'selected' : ''}>Released</option>
        </select>
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="col-notes" rows="2">${editCollateral?.notes || ''}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Collateral' : 'Add Collateral',
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onConfirm: () => {
      const desc = document.getElementById('col-desc')?.value.trim()
      if (!desc) { showToast('Description is required', 'error'); return false }
      return {
        partyId,
        type: document.getElementById('col-type')?.value || 'other',
        description: desc,
        serialNumber: document.getElementById('col-serial')?.value.trim() || '',
        weight: document.getElementById('col-weight')?.value.trim() || '',
        estimatedValue: parseFloat(document.getElementById('col-value')?.value) || 0,
        status: document.getElementById('col-status')?.value || 'held',
        notes: document.getElementById('col-notes')?.value.trim() || '',
      }
    },
  })

  if (!result || result === true) return

  if (isEdit) result._id = editCollateral._id

  await saveCollateral(result)
  logAction(isEdit ? 'update' : 'create', 'collateral', result._id || '', `${isEdit ? 'Updated' : 'Added'} collateral: ${result.description}`)
  showToast(isEdit ? 'Collateral updated' : 'Collateral added')
  renderPartyDetail(container, navigate, { id: partyId })
}

function showPartyMenu(party, allTxns, sources, container, navigate) {
  showModal({
    title: party.name,
    content: `
      <div class="space-y-1">
        <button class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 text-sm flex items-center gap-3" id="menu-edit"><ion-icon name="create-outline" class="text-gray-400"></ion-icon> Edit Party</button>
        <button class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 text-sm flex items-center gap-3" id="menu-interest"><ion-icon name="calculator-outline" class="text-gray-400"></ion-icon> Calculate Interest</button>
        <button class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50 text-sm flex items-center gap-3 text-red-500" id="menu-delete"><ion-icon name="trash-outline"></ion-icon> Delete Party</button>
      </div>
    `,
    confirmText: 'Close',
    showCancel: false,
  })

  document.getElementById('menu-edit')?.addEventListener('click', () => {
    document.querySelector('[data-dismiss]')?.click()
    showPartyForm(party, [], [], container, navigate)
  })

  document.getElementById('menu-interest')?.addEventListener('click', () => {
    document.querySelector('[data-dismiss]')?.click()
    showInterestPreview(party, allTxns)
  })

  document.getElementById('menu-delete')?.addEventListener('click', async () => {
    document.querySelector('[data-dismiss]')?.click()
    const confirmed = await showConfirm({ title: 'Delete Party?', message: 'This will permanently delete this party and all their transactions.', confirmText: 'Delete', danger: true })
    if (confirmed) {
      for (const t of allTxns) await deleteTransaction(t._id)
      for (const c of await getCollaterals(party._id)) await deleteCollateral(c._id)
      await deleteParty(party._id)
      logAction('delete', 'party', party._id, 'Deleted party')
      showToast('Party deleted')
      navigate('parties')
    }
  })
}

async function showPartyForm(party, sources, allTxns, container, navigate) {
  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Full Name *</label>
        <input class="input" id="pf-name" value="${party?.name || ''}" />
      </div>
      <div>
        <label class="input-label">Phone</label>
        <input class="input" id="pf-phone" type="tel" value="${party?.phone || ''}" />
      </div>
      <div>
        <label class="input-label">Address</label>
        <textarea class="input" id="pf-address" rows="2">${party?.address || ''}</textarea>
      </div>
      <div>
        <label class="input-label">Identity</label>
        <input class="input" id="pf-identity" value="${party?.identity || ''}" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Risk</label>
          <select class="input" id="pf-risk">
            ${['low', 'medium', 'high', 'critical'].map((r) =>
              `<option value="${r}" ${party?.riskCategory === r ? 'selected' : ''}>${r}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="input-label">Status</label>
          <select class="input" id="pf-status">
            ${['active', 'closed', 'defaulted'].map((s) =>
              `<option value="${s}" ${party?.status === s ? 'selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="input-label">Interest Rate (%/mo)</label>
        <input class="input" id="pf-rate" type="number" step="0.1" value="${party?.interestRate || '0'}" />
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="pf-notes" rows="2">${party?.notes || ''}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Edit Party',
    content,
    confirmText: 'Update',
    onConfirm: () => {
      const name = document.getElementById('pf-name')?.value.trim()
      if (!name) { showToast('Name is required', 'error'); return false }
      return {
        ...party,
        name,
        phone: document.getElementById('pf-phone')?.value.trim() || '',
        address: document.getElementById('pf-address')?.value.trim() || '',
        identity: document.getElementById('pf-identity')?.value.trim() || '',
        riskCategory: document.getElementById('pf-risk')?.value || 'low',
        status: document.getElementById('pf-status')?.value || 'active',
        interestRate: parseFloat(document.getElementById('pf-rate')?.value) || 0,
        notes: document.getElementById('pf-notes')?.value.trim() || '',
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  await saveParty(result)
  logAction('update', 'party', party._id, 'Updated party details')
  showToast('Party updated')
  renderPartyDetail(container, navigate, { id: party._id })
}

async function showInterestPreview(party, allTxns) {
  const outstanding = getOutstandingForParty(allTxns)
  const asOfDate = new Date().toISOString().split('T')[0]
  const firstTxnDate = allTxns.length > 0
    ? [...allTxns].sort((a, b) => new Date(a.date) - new Date(b.date))[0]?.date?.split('T')[0]
    : null
  const fromDate = firstTxnDate || party.createdAt?.split('T')[0] || asOfDate
  const interest = calculateInterest({
    principal: Math.max(0, outstanding),
    rate: party.interestRate,
    fromDate,
    toDate: asOfDate,
  })

  showModal({
    title: 'Interest Calculation',
    content: `
      <div class="space-y-3">
        <div class="card-flat bg-gray-50">
          <div class="flex justify-between py-1.5">
            <span class="text-sm text-gray-500">Principal</span>
            <span class="font-mono font-semibold">${formatCurrencyFull(outstanding > 0 ? outstanding : 0)}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span class="text-sm text-gray-500">Rate</span>
            <span class="font-mono font-semibold">${party.interestRate}% / month</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span class="text-sm text-gray-500">Period</span>
            <span class="font-mono font-semibold">${interest.days} days</span>
          </div>
          <div class="flex justify-between py-1.5 border-t border-gray-200 mt-1.5 pt-2">
            <span class="text-sm text-gray-500">Interest Accrued</span>
            <span class="font-mono font-bold text-amber-600">${formatCurrencyFull(interest.interest)}</span>
          </div>
          <div class="flex justify-between py-1.5">
            <span class="text-sm font-semibold">Total Payable</span>
            <span class="font-mono font-bold text-red-500">${formatCurrencyFull(interest.total)}</span>
          </div>
        </div>
        <p class="text-xs text-gray-400">Interest is calculated from the first transaction date to today.</p>
      </div>
    `,
    confirmText: 'Done',
    showCancel: false,
  })
}
