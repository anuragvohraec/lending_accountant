import { getParty, saveParty, deleteParty, getMoneySources, getTransactions, saveTransaction, deleteTransaction, getCollaterals, saveCollateral, deleteCollateral, getCollateralImageDataUrl, getLedgers, saveLedger, deleteLedger, migrateLedgers, saveSourceTransaction } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDate, formatDateTime, accountStatusColor, riskColor, collateralStatusColor } from '../utils/formatters.js'
import { calculateMonthlyCharges, getOutstandingForParty, getInterestPending, getPartnerWiseOutstanding, getLastInterestChargeDate, getFirstPrincipalDate } from '../services/interest.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm, showPrompt } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { dateInputHTML, setupDateInput, getDateInputValue } from '../utils/dateInput.js'
import { escHtml } from '../utils/helpers.js'

export async function renderPartyDetail(container, navigate, params) {
  const removeLoader = showSkeleton(container)
  const [party, sources, allTxns, collaterals, ledgers] = await Promise.all([
    getParty(params.id), getMoneySources(), getTransactions(params.id), getCollaterals(params.id), getLedgers(params.id),
  ])
  for (const c of collaterals) {
    if (c._attachments?.image && !c.image) {
      c.image = await getCollateralImageDataUrl(c._id)
    }
  }

  if (!ledgers || ledgers.length === 0) {
    await migrateLedgers(params.id)
    const [newLedgers, newTxns, newColls] = await Promise.all([getLedgers(params.id), getTransactions(params.id), getCollaterals(params.id)])
    ledgers.push(...newLedgers)
    allTxns.length = 0; allTxns.push(...newTxns)
    collaterals.length = 0; collaterals.push(...newColls)
    for (const c of collaterals) {
      if (c._attachments?.image && !c.image) c.image = await getCollateralImageDataUrl(c._id)
    }
  }
  removeLoader()

  if (!party) {
    container.innerHTML = '<div class="empty-state"><p>Party not found</p></div>'
    return
  }

  ledgers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  let selectedLedger = params.ledgerId
    ? ledgers.find((l) => l._id === params.ledgerId) || ledgers[0]
    : ledgers[0]
  let ledgerFilter = ['open']
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  function getLedgerTxns(ledgerId) {
    return allTxns.filter((t) => t.ledgerId === ledgerId)
  }

  function getLedgerCollaterals(ledgerId) {
    return collaterals.filter((c) => c.ledgerId === ledgerId)
  }

  function renderCommonSummary() {
    const outstanding = getOutstandingForParty(allTxns)
    const totalDebit = allTxns.filter((t) => t.category !== 'interest' && t.type === 'debit').reduce((s, t) => s + t.amount, 0)
    const totalCredit = allTxns.filter((t) => t.category !== 'interest' && t.type === 'credit').reduce((s, t) => s + t.amount, 0)
    const heldCollateral = collaterals.filter((c) => c.status === 'held')
    const securityValue = heldCollateral.reduce((s, c) => s + (c.estimatedValue || 0), 0)

    document.getElementById('common-summary').innerHTML = `
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
    `
  }

  function renderCommonInterestSummary() {
    const hasInterestLedger = ledgers.some(l => l.interestRate > 0)
    const el = document.getElementById('common-interest-summary')
    if (!hasInterestLedger) { el.classList.add('hidden'); return }

    const outstanding = getOutstandingForParty(allTxns)
    const interestTxns = allTxns.filter((t) => t.category === 'interest')
    const pendingInterest = interestTxns.reduce((s, t) => s + (t.type === 'charge' ? t.amount : -t.amount), 0)
    const totalIncome = interestTxns.filter((t) => t.type === 'payment').reduce((s, t) => s + t.amount, 0)

    el.innerHTML = `
      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Interest Summary</h3>
        <div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-sm text-gray-500">Principal Outstanding</span>
            <span class="font-mono font-semibold text-sm">${formatCurrencyFull(outstanding)}</span>
          </div>
          <div class="flex items-center justify-between py-1.5">
            <span class="text-sm text-gray-500">Pending Interest</span>
            <span class="font-mono font-semibold text-sm ${pendingInterest > 0 ? 'text-amber-600' : ''}">${formatCurrencyFull(pendingInterest)}</span>
          </div>
          <div class="flex items-center justify-between py-1.5 border-t border-gray-100 mt-1.5 pt-2">
            <span class="text-sm text-gray-500">Total Interest Income</span>
            <span class="font-mono font-semibold text-sm text-green-600">${formatCurrencyFull(totalIncome)}</span>
          </div>
        </div>
      </div>
    `
    el.classList.remove('hidden')
  }

  function renderCommonSourceOutstanding() {
    const el = document.getElementById('common-source-outstanding')
    const partnerWise = getPartnerWiseOutstanding(allTxns, sources)
    const entries = Object.entries(partnerWise)

    if (entries.length === 0) { el.classList.add('hidden'); return }

    el.innerHTML = `
      <div class="card">
        <h3 class="font-semibold text-sm mb-3">Partner-wise Outstanding</h3>
        ${entries.map(([owner, amount]) => `
          <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
            <span class="text-sm">${owner}</span>
            <span class="${amount > 0 ? 'amount-negative' : 'amount-neutral'} text-sm">${formatCurrencyFull(amount)}</span>
          </div>
        `).join('')}
      </div>
    `
    el.classList.remove('hidden')
  }

  function renderLedgerContent() {
    if (!selectedLedger) {
      const el = document.getElementById('ledger-content')
      if (el) el.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">No ledgers match the current filter</div>'
      return
    }
    const lid = selectedLedger._id
    const txns = getLedgerTxns(lid)
    const colls = getLedgerCollaterals(lid)
    const principalTxns = txns.filter((t) => !t.category || t.category === 'principal')
    const interestTxns = txns.filter((t) => t.category === 'interest')

    const totalDebit = txns.filter((t) => t.category !== 'interest' && t.type === 'debit').reduce((s, t) => s + t.amount, 0)
    const totalCredit = txns.filter((t) => t.category !== 'interest' && t.type === 'credit').reduce((s, t) => s + t.amount, 0)

    document.getElementById('ledger-content').innerHTML = `
      <div class="grid grid-cols-2 gap-2">
        <div class="card-flat text-center">
          <div class="stat-value text-red-500">${formatCurrency(totalDebit)}</div>
          <div class="stat-label">Given (This Ledger)</div>
        </div>
        <div class="card-flat text-center">
          <div class="stat-value text-green-500">${formatCurrency(totalCredit)}</div>
          <div class="stat-label">Returned (This Ledger)</div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Collateral (${colls.length})</h3>
          <button class="text-xs text-primary font-medium" id="add-collateral-btn">+ Add</button>
        </div>
        <div id="collateral-list"></div>
      </div>

      <div class="card">
        <div class="mb-3">
          <h3 class="font-semibold text-sm mb-2.5">Principal Transaction History (${principalTxns.length})</h3>
          <div class="flex gap-2">
            <button class="flex-1 text-sm font-semibold py-2.5 rounded-xl border-2 border-red-200 text-red-600 bg-red-50 active:bg-red-100 active:scale-[0.97] transition-all" id="add-debit-btn">Debit (Give)</button>
            <button class="flex-1 text-sm font-semibold py-2.5 rounded-xl border-2 border-green-200 text-green-600 bg-green-50 active:bg-green-100 active:scale-[0.97] transition-all" id="add-credit-btn">Credit (Return)</button>
          </div>
        </div>
        <div id="principal-txn-list"></div>
      </div>

      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Interest Transaction History (${interestTxns.length})</h3>
          <div class="flex gap-2">
            <button class="text-xs text-primary font-medium" id="calc-interest-btn">Calculate Interest</button>
            <button class="text-xs text-primary font-medium" id="pay-interest-btn">Record Payment</button>
          </div>
        </div>
        <div id="interest-txn-list"></div>
      </div>
    `

    renderCollateralList(colls, party, txns, sources, container, navigate, lid)
    renderPrincipalTransactions(principalTxns, sources, party, txns, container, navigate, lid)
    renderInterestTransactions(interestTxns, sources, party, container, navigate, lid)

    document.getElementById('add-collateral-btn')?.addEventListener('click', () => showCollateralForm(null, party._id, colls, party, txns, sources, container, navigate, lid))
    document.getElementById('add-debit-btn')?.addEventListener('click', () => showTransactionForm(null, party, sources, txns, container, navigate, 'debit', lid))
    document.getElementById('add-credit-btn')?.addEventListener('click', () => showTransactionForm(null, party, sources, txns, container, navigate, 'credit', lid))
    document.getElementById('calc-interest-btn')?.addEventListener('click', () => showInterestChargeForm(party, txns, sources, container, navigate, lid, selectedLedger))
    document.getElementById('pay-interest-btn')?.addEventListener('click', () => showInterestPaymentForm(party, txns, sources, container, navigate, lid))
  }

  function showLedgerFilter() {
    showModal({
      title: 'Filter Ledgers',
      content: `
        <div class="space-y-2">
          ${['open', 'closed', 'defaulted'].map(s => `
            <label class="flex items-center gap-2">
              <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary ledger-filter-cb" value="${s}" ${ledgerFilter.includes(s) ? 'checked' : ''} />
              <span class="text-sm capitalize">${s}</span>
            </label>
          `).join('')}
        </div>
      `,
      confirmText: 'Apply',
      onConfirm: () => {
        const checked = Array.from(document.querySelectorAll('.ledger-filter-cb:checked')).map(cb => cb.value)
        if (checked.length === 0) { showToast('Select at least one status', 'error'); return false }
        ledgerFilter = checked
        renderLedgerTabs()
        renderLedgerContent()
      },
    })
  }

  function renderLedgerTabs() {
    const el = document.getElementById('ledger-tabs')
    const filtered = ledgers
      .filter(l => ledgerFilter.includes(l.status))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    if (filtered.length === 0) {
      selectedLedger = null
      document.getElementById('ledger-content').innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">No ledgers match the current filter</div>'
      el.innerHTML = `<div class="flex items-center gap-1 pb-1"><button class="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center" id="filter-ledger-btn" title="Filter Ledgers"><ion-icon name="funnel-outline" class="text-sm"></ion-icon></button><div class="flex-1"></div><button class="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center text-lg font-light leading-none" id="add-ledger-btn" title="Add Ledger">+</button></div>`
      document.getElementById('filter-ledger-btn')?.addEventListener('click', showLedgerFilter)
      document.getElementById('add-ledger-btn')?.addEventListener('click', showCreateLedgerForm)
      return
    }
    if (!filtered.find(l => l._id === selectedLedger?._id)) {
      selectedLedger = filtered[0]
    }
    el.innerHTML = `
      <div class="flex items-center gap-1 pb-1">
        <button class="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center" id="filter-ledger-btn" title="Filter Ledgers">
          <ion-icon name="funnel-outline" class="text-sm"></ion-icon>
        </button>
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1">
          ${filtered.map((l) => {
            const active = l._id === selectedLedger._id
            const statusDot = l.status === 'open' ? 'bg-green-500' : l.status === 'closed' ? 'bg-gray-400' : 'bg-red-500'
            return `
              <button class="ledger-tab flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                active ? 'bg-primary text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }" data-id="${l._id}">
                <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>
                ${escHtml(l.name)}
                <span class="text-[10px] opacity-70">${l.interestRate}%</span>
                <ion-icon name="chevron-down-outline" class="text-xs ml-0.5 ledger-more" data-id="${l._id}"></ion-icon>
              </button>
            `
          }).join('')}
        </div>
        <button class="shrink-0 w-7 h-7 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center text-lg font-light leading-none" id="add-ledger-btn" title="Add Ledger">+</button>
      </div>
    `

    el.querySelectorAll('.ledger-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.ledger-more')) return
        const id = btn.dataset.id
        if (id !== selectedLedger._id) {
          selectedLedger = ledgers.find((l) => l._id === id)
          renderLedgerTabs()
          renderLedgerContent()
        }
      })
    })

    el.querySelectorAll('.ledger-more').forEach((icon) => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation()
        showLedgerMenu(ledgers.find((l) => l._id === icon.dataset.id))
      })
    })

    document.getElementById('add-ledger-btn')?.addEventListener('click', showCreateLedgerForm)
    document.getElementById('filter-ledger-btn')?.addEventListener('click', showLedgerFilter)
  }

  async function showCreateLedgerForm() {
    const result = await showModal({
      title: 'New Ledger',
      content: `
        <div class="space-y-3">
          <div>
            <label class="input-label">Ledger Name *</label>
            <input class="input" id="lg-name" placeholder="e.g. Loan #1, Personal Loan" />
          </div>
          <div>
            <label class="input-label">Interest Rate (% per month)</label>
            <input class="input" id="lg-rate" type="number" step="0.1" value="0" />
          </div>
          <div>
            <label class="input-label">Status</label>
            <select class="input" id="lg-status">
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="defaulted">Defaulted</option>
            </select>
          </div>
          <div>
            <label class="input-label">Notes</label>
            <textarea class="input" id="lg-notes" rows="2"></textarea>
          </div>
        </div>
      `,
      confirmText: 'Create',
      onConfirm: () => {
        const name = document.getElementById('lg-name')?.value.trim()
        if (!name) { showToast('Ledger name is required', 'error'); return false }
        return {
          partyId: party._id,
          name,
          interestRate: parseFloat(document.getElementById('lg-rate')?.value) || 0,
          status: document.getElementById('lg-status')?.value || 'open',
          notes: document.getElementById('lg-notes')?.value.trim() || '',
        }
      },
    })

    if (!result || result === true) return
    await saveLedger(result)
    logAction('create', 'ledger', party._id, `Created ledger: ${result.name}`)
    showToast('Ledger created')
    renderPartyDetail(container, navigate, { id: party._id })
  }

  async function showLedgerMenu(ledger) {
    showModal({
      title: escHtml(ledger.name),
      content: `
        <div class="space-y-1">
          <button class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 text-sm flex items-center gap-3" id="ledger-edit"><ion-icon name="create-outline" class="text-gray-400"></ion-icon> Edit Ledger</button>
          <button class="w-full text-left px-3 py-2.5 rounded-lg hover:bg-red-50 text-sm flex items-center gap-3 text-red-500" id="ledger-delete"><ion-icon name="trash-outline"></ion-icon> Delete Ledger</button>
        </div>
      `,
      confirmText: 'Close',
      showCancel: false,
    })

    document.getElementById('ledger-edit')?.addEventListener('click', () => {
      document.querySelector('[data-dismiss]')?.click()
      showEditLedgerForm(ledger)
    })

    document.getElementById('ledger-delete')?.addEventListener('click', () => {
      document.querySelector('[data-dismiss]')?.click()
      deleteLedgerWithCascade(ledger)
    })
  }

  async function showEditLedgerForm(ledger) {
    const result = await showModal({
      title: 'Edit Ledger',
      content: `
        <div class="space-y-3">
          <div>
            <label class="input-label">Ledger Name *</label>
            <input class="input" id="lg-edit-name" value="${escHtml(ledger.name)}" />
          </div>
          <div>
            <label class="input-label">Interest Rate (% per month)</label>
            <input class="input" id="lg-edit-rate" type="number" step="0.1" value="${ledger.interestRate}" />
          </div>
          <div>
            <label class="input-label">Status</label>
            <select class="input" id="lg-edit-status">
              ${['open', 'closed', 'defaulted'].map((s) =>
                `<option value="${s}" ${ledger.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label class="input-label">Notes</label>
            <textarea class="input" id="lg-edit-notes" rows="2">${escHtml(ledger.notes || '')}</textarea>
          </div>
        </div>
      `,
      confirmText: 'Update',
      onConfirm: () => {
        const name = document.getElementById('lg-edit-name')?.value.trim()
        if (!name) { showToast('Ledger name is required', 'error'); return false }
        return {
          ...ledger,
          name,
          interestRate: parseFloat(document.getElementById('lg-edit-rate')?.value) || 0,
          status: document.getElementById('lg-edit-status')?.value || 'open',
          notes: document.getElementById('lg-edit-notes')?.value.trim() || '',
          updatedAt: new Date().toISOString(),
        }
      },
    })

    if (!result || result === true) return
    await saveLedger(result)
    logAction('update', 'ledger', ledger._id, `Updated ledger: ${result.name}`)
    showToast('Ledger updated')
    renderPartyDetail(container, navigate, { id: party._id })
  }

  async function deleteLedgerWithCascade(ledger) {
    if (ledgers.length <= 1) {
      showToast('Cannot delete the only ledger', 'error')
      return
    }
    const txns = getLedgerTxns(ledger._id)
    const colls = getLedgerCollaterals(ledger._id)
    const txnCount = txns.length
    const collCount = colls.length
    const confirmed = await showConfirm({
      title: 'Delete Ledger?',
      message: `This will permanently delete "${ledger.name}" and all its data (${txnCount} transactions, ${collCount} collateral items).`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!confirmed) return
    for (const t of txns) await deleteTransaction(t._id)
    for (const c of colls) await deleteCollateral(c._id)
    await deleteLedger(ledger._id)
    logAction('delete', 'ledger', ledger._id, `Deleted ledger: ${ledger.name} with ${txnCount} txns, ${collCount} colls`)
    showToast('Ledger deleted')
    renderPartyDetail(container, navigate, { id: party._id })
  }

  renderHeader(party.name, {
    onBack: () => navigate('parties'),
    rightAction: `<button class="btn-ghost btn-icon" id="party-menu"><ion-icon name="ellipsis-vertical-outline" class="text-xl"></ion-icon></button>`,
  })

  document.getElementById('party-menu')?.addEventListener('click', () => showPartyMenu(party, allTxns, sources, container, navigate))

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
        ${party.address ? `<p class="text-xs text-gray-400 flex items-start gap-1"><ion-icon name="location-outline" class="text-sm mt-0.5 shrink-0"></ion-icon>${escHtml(party.address)}</p>` : ''}
        ${party.notes ? `<p class="text-xs text-gray-500 mt-1">${escHtml(party.notes)}</p>` : ''}
      </div>

      <div id="common-summary"></div>
      <div id="common-interest-summary" class="hidden"></div>
      <div id="common-source-outstanding" class="hidden"></div>

      <div id="ledger-tabs"></div>

      <div id="ledger-content" class="space-y-3"></div>
    </div>
  `

  renderCommonSummary()
  renderCommonInterestSummary()
  renderCommonSourceOutstanding()
  renderLedgerTabs()
  renderLedgerContent()
}

function renderCollateralList(collaterals, party, allTxns, sources, container, navigate, ledgerId) {
  const el = document.getElementById('collateral-list')
  if (collaterals.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No collateral items</p>'
    return
  }

  el.innerHTML = collaterals.map((c) => {
    const updated = c.lastUpdated || c.dateAdded
    return `
    <div class="py-2.5 border-b border-gray-50 last:border-0">
      <div class="flex items-start justify-between">
        <div class="flex items-start gap-2 flex-1 min-w-0">
          ${c.image ? `<img src="${c.image}" class="w-12 h-12 rounded-lg object-cover shrink-0" />` : `<div class="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center shrink-0"><ion-icon name="${c.type === 'gold' ? 'diamond-outline' : c.type === 'electronics' ? 'laptop-outline' : c.type === 'vehicle' ? 'car-outline' : c.type === 'document' ? 'document-text-outline' : 'cube-outline'}" class="text-gray-400 text-lg"></ion-icon></div>`}
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${c.description || c.type}</div>
            <div class="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
              <span class="${collateralStatusColor(c.status)} status-toggle" data-id="${c._id}" data-status="${c.status}">${c.status === 'held' ? 'In Possession' : 'Returned'}</span>
              ${c.serialNumber ? `<span>· ${c.serialNumber}</span>` : ''}
            </div>
            <div class="text-[10px] text-gray-400 mt-0.5">Updated ${formatDate(updated)}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 ml-3">
          <button class="btn-icon text-gray-300 hover:text-primary edit-collateral" data-id="${c._id}" title="Edit"><ion-icon name="create-outline" class="text-lg"></ion-icon></button>
          <div class="text-right">
            <div class="font-mono font-semibold text-sm">${formatCurrencyFull(c.estimatedValue || 0)}</div>
          </div>
        </div>
      </div>
    </div>
    `
  }).join('')

  el.querySelectorAll('.status-toggle').forEach((badge) => {
    badge.addEventListener('click', async () => {
      const id = badge.dataset.id
      const current = badge.dataset.status
      const newStatus = current === 'held' ? 'released' : 'held'
      const confirmed = await showConfirm({ title: 'Change Status?', message: `Mark this collateral as ${newStatus === 'held' ? 'In Possession' : 'Returned'}?`, confirmText: 'Update', danger: false })
      if (!confirmed) return
      const col = collaterals.find((c) => c._id === id)
      if (!col) return
      await saveCollateral({ ...col, status: newStatus, lastUpdated: new Date().toISOString() })
      logAction('update', 'collateral', id, `Changed collateral status to ${newStatus}`)
      showToast(`Collateral marked as ${newStatus === 'held' ? 'In Possession' : 'Returned'}`)
      renderPartyDetail(container, navigate, { id: party._id })
    })
  })

  el.querySelectorAll('.edit-collateral').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = collaterals.find((c) => c._id === btn.dataset.id)
      if (col) showCollateralForm(col, party._id, collaterals, party, allTxns, sources, container, navigate, ledgerId)
    })
  })
}

function renderPrincipalTransactions(txns, sources, party, allTxns, container, navigate, ledgerId) {
  const el = document.getElementById('principal-txn-list')
  if (txns.length === 0) {
    el.innerHTML = '<div class="empty-state"><ion-icon name="receipt-outline"></ion-icon><p class="text-xs text-gray-400">No principal transactions yet</p></div>'
    return
  }

  let runningBalance = 0
  const sorted = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date))

  el.innerHTML = sorted.map((t) => {
    runningBalance += t.type === 'debit' ? t.amount : -t.amount
    const allocs = t.sourceAllocations || []
    const sourceNames = allocs.map((a) => sources.find((s) => s._id === a.sourceId)?.name || 'Unknown').join(', ')
    const rowId = 'src-' + (t._id || Math.random().toString(36).slice(2))
    return `
      <div class="py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${t.type === 'debit' ? 'bg-red-400' : 'bg-green-400'} shrink-0"></span>
              <span class="text-sm font-medium">${t.type === 'debit' ? 'Given' : 'Returned'}</span>
              ${t.tags ? t.tags.split(',').map((tag) => `<span class="badge-gray text-[10px]">${tag.trim()}</span>`).join('') : ''}
            </div>
            <div class="text-xs text-gray-400 mt-0.5">${formatDateTime(t.date)}</div>
            ${t.notes ? `<div class="text-xs text-gray-500 mt-0.5 truncate">${escHtml(t.notes)}</div>` : ''}
            ${sourceNames ? `<div class="text-xs text-gray-400 mt-0.5">${t.type === 'debit' ? 'From' : 'To'}: ${sourceNames}</div>` : ''}
            ${allocs.length > 0 ? `<button class="text-xs text-primary mt-1.5" onclick="document.getElementById('${rowId}').classList.toggle('hidden')">View breakdown &rsaquo;</button>` : ''}
          </div>
          <div class="text-right ml-3">
            <div class="flex items-center gap-2 justify-end">
              <button class="text-gray-300 hover:text-red-500 delete-principal-txn" data-id="${t._id}" title="Delete">
                <ion-icon name="trash-outline" class="text-base"></ion-icon>
              </button>
              <button class="text-gray-300 hover:text-primary edit-principal-txn" data-id="${t._id}" title="Edit">
                <ion-icon name="create-outline" class="text-base"></ion-icon>
              </button>
              <div>
                <div class="${t.type === 'debit' ? 'amount-negative' : 'amount-positive'} text-sm">${t.type === 'debit' ? '-' : '+'}${formatCurrencyFull(t.amount)}</div>
                <div class="text-xs font-mono text-gray-400">${formatCurrencyFull(runningBalance)}</div>
              </div>
            </div>
          </div>
        </div>
        ${allocs.length > 0 ? `
        <div id="${rowId}" class="hidden mt-3 overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-gray-400 border-b border-gray-100">
                <th class="text-left pb-1.5 font-medium">Source</th>
                <th class="text-right pb-1.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${allocs.map((a) => {
                const src = sources.find((s) => s._id === a.sourceId)
                return `
                  <tr class="border-b border-gray-50">
                    <td class="text-left py-1.5 text-gray-600">${src?.name || 'Unknown'}</td>
                    <td class="text-right py-1.5 font-mono">${formatCurrencyFull(a.amount)}</td>
                  </tr>
                `
              }).join('')}
              <tr class="font-semibold border-t border-gray-200">
                <td class="text-left py-1.5 text-gray-500">Total</td>
                <td class="text-right py-1.5 font-mono">${formatCurrencyFull(t.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>
    `
  }).join('')

  el.querySelectorAll('.edit-principal-txn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const txn = allTxns.find((t) => t._id === btn.dataset.id)
      if (txn) showTransactionForm(txn, party, sources, allTxns, container, navigate, null, ledgerId)
    })
  })

  el.querySelectorAll('.delete-principal-txn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({ title: 'Delete Transaction?', message: 'This will permanently remove this principal transaction. Any future interest charges will be invalidated.', confirmText: 'Delete', danger: true })
      if (!confirmed) return
      await deleteTransaction(btn.dataset.id)
      logAction('delete', 'transaction', btn.dataset.id, 'Deleted principal transaction')
      showToast('Transaction deleted')
      renderPartyDetail(container, navigate, { id: party._id })
    })
  })
}

function renderInterestTransactions(txns, sources, party, container, navigate, ledgerId) {
  const el = document.getElementById('interest-txn-list')
  if (txns.length === 0) {
    el.innerHTML = '<div class="empty-state"><ion-icon name="calculator-outline"></ion-icon><p class="text-xs text-gray-400">No interest transactions yet</p></div>'
    return
  }

  let runningBalance = 0
  const sorted = [...txns].sort((a, b) => new Date(a.date) - new Date(b.date))

  el.innerHTML = sorted.map((t) => {
    runningBalance += t.type === 'charge' ? t.amount : -t.amount
    const hasBreakdown = t.type === 'charge' && t.breakdown && t.breakdown.length > 0
    const allocs = t.sourceAllocations || []
    const hasSrcAllocs = t.type === 'payment' && allocs.length > 0
    const rowId = 'brk-' + (t._id || Math.random().toString(36).slice(2))
    const srcRowId = 'src-' + (t._id || Math.random().toString(36).slice(2))
    const totalDays = hasBreakdown ? t.breakdown.reduce((s, b) => s + b.days, 0) : 0
    return `
      <div class="py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${t.type === 'charge' ? 'bg-amber-400' : 'bg-green-400'} shrink-0"></span>
              <span class="text-sm font-medium">${t.type === 'charge' ? 'Interest Charged' : 'Interest Paid'}</span>
            </div>
            <div class="text-xs text-gray-400 mt-0.5">${formatDateTime(t.date)}</div>
            ${t.notes ? `
              <div class="text-xs text-gray-500 mt-0.5">
                ${t.notes.length > 80
                  ? `<span class="note-short">${escHtml(t.notes.slice(0, 80))}...</span><span class="note-full hidden" style="white-space:pre-wrap"></span> <button class="text-primary note-toggle text-xs" data-full="${escHtml(t.notes)}">Read more</button>`
                  : `<span style="white-space:pre-wrap">${escHtml(t.notes)}</span>`
                }
              </div>
            ` : ''}
            ${hasBreakdown ? `<button class="text-xs text-primary mt-1.5" onclick="document.getElementById('${rowId}').classList.toggle('hidden')">View calculation &rsaquo;</button>` : ''}
            ${hasSrcAllocs ? `<button class="text-xs text-primary mt-1.5" onclick="document.getElementById('${srcRowId}').classList.toggle('hidden')">View breakdown &rsaquo;</button>` : ''}
          </div>
          <div class="flex items-center gap-2 ml-3">
            ${t.type === 'charge'
              ? `<button class="btn-icon text-gray-300 hover:text-red-500 delete-int-charge" data-id="${t._id}" data-date="${t.date}" title="Delete"><ion-icon name="trash-outline" class="text-lg"></ion-icon></button>`
              : `<button class="btn-icon text-gray-300 hover:text-red-500 delete-int-payment" data-id="${t._id}" title="Delete"><ion-icon name="trash-outline" class="text-lg"></ion-icon></button>`}
            <div class="text-right">
              <div class="${t.type === 'charge' ? 'amount-negative' : 'amount-positive'} text-sm">${t.type === 'charge' ? '+' : '-'}${formatCurrencyFull(t.amount)}</div>
              <div class="text-xs font-mono text-gray-400">${formatCurrencyFull(runningBalance)}</div>
            </div>
          </div>
        </div>
        ${hasBreakdown ? `
        <div id="${rowId}" class="hidden mt-3 overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-gray-400 border-b border-gray-100">
                <th class="text-right pr-2 pb-1.5 font-medium">Debit</th>
                <th class="text-right pr-2 pb-1.5 font-medium">Credit</th>
                <th class="text-right pr-2 pb-1.5 font-medium">Outstanding</th>
                <th class="text-left px-2 pb-1.5 font-medium">Date</th>
                <th class="text-right px-2 pb-1.5 font-medium">Days</th>
                <th class="text-right pl-2 pb-1.5 font-medium">Interest</th>
              </tr>
            </thead>
            <tbody>
              ${t.breakdown.map((b) => `
                <tr class="border-b border-gray-50">
                  <td class="text-right pr-2 py-1.5 ${b.debit > 0 ? 'text-red-600 font-medium' : 'text-gray-300'}">${b.debit > 0 ? formatCurrencyFull(b.debit) : '-'}</td>
                  <td class="text-right pr-2 py-1.5 ${b.credit > 0 ? 'text-green-600 font-medium' : 'text-gray-300'}">${b.credit > 0 ? formatCurrencyFull(b.credit) : '-'}</td>
                  <td class="text-right pr-2 py-1.5 font-mono font-medium">${formatCurrencyFull(b.outstanding)}</td>
                  <td class="text-left px-2 py-1.5 text-gray-500">${formatDate(b.date)}</td>
                  <td class="text-right px-2 py-1.5 font-mono">${b.days}</td>
                  <td class="text-right pl-2 py-1.5 font-mono text-amber-600">${formatCurrencyFull(b.amount)}</td>
                </tr>
              `).join('')}
              <tr class="font-semibold border-t border-gray-200">
                <td colspan="4" class="text-right pr-2 py-1.5"></td>
                <td class="text-right px-2 py-1.5 font-mono">${totalDays}</td>
                <td class="text-right pl-2 py-1.5 font-mono text-amber-600">${formatCurrencyFull(t.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}
        ${hasSrcAllocs ? `
        <div id="${srcRowId}" class="hidden mt-3 overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="text-gray-400 border-b border-gray-100">
                <th class="text-left pb-1.5 font-medium">Source</th>
                <th class="text-right pb-1.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${allocs.map((a) => {
                const src = sources.find((s) => s._id === a.sourceId)
                return `
                  <tr class="border-b border-gray-50">
                    <td class="text-left py-1.5 text-gray-600">${src?.name || 'Unknown'}</td>
                    <td class="text-right py-1.5 font-mono">${formatCurrencyFull(a.amount)}</td>
                  </tr>
                `
              }).join('')}
              <tr class="font-semibold border-t border-gray-200">
                <td class="text-left py-1.5 text-gray-500">Total</td>
                <td class="text-right py-1.5 font-mono">${formatCurrencyFull(t.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ` : ''}
      </div>
    `
  }).join('')

  el.querySelectorAll('.delete-int-payment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({ title: 'Delete Payment?', message: 'This will remove this interest payment entry.', confirmText: 'Delete', danger: true })
      if (!confirmed) return
      await deleteTransaction(btn.dataset.id)
      logAction('delete', 'transaction', btn.dataset.id, 'Deleted interest payment')
      showToast('Interest payment deleted')
      renderPartyDetail(container, navigate, { id: party._id })
    })
  })

  el.querySelectorAll('.delete-int-charge').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const chargeDate = btn.dataset.date
      const charges = txns.filter(t => t.type === 'charge')
      const toDelete = charges.filter(t => new Date(t.date) >= new Date(chargeDate))
      const msg = toDelete.length === 1
        ? `This will remove the interest charge dated ${formatDate(chargeDate)}. You will need to recalculate interest. Continue?`
        : `This will remove ${toDelete.length} interest charges from ${formatDate(chargeDate)} onwards. Interest payments will not be affected. You will need to recalculate interest. Continue?`
      const confirmed = await showConfirm({
        title: 'Delete Interest Charge?',
        message: msg,
        confirmText: toDelete.length > 1 ? `Delete ${toDelete.length} Charges` : 'Delete',
        danger: true,
      })
      if (!confirmed) return
      for (const charge of toDelete) {
        await deleteTransaction(charge._id)
      }
      logAction('delete', 'transaction', party._id, `Deleted ${toDelete.length} interest charges from ${formatDate(chargeDate)} onwards`)
      showToast(`Deleted ${toDelete.length} interest charge(s)`)
      renderPartyDetail(container, navigate, { id: party._id })
    })
  })

  el.querySelectorAll('.note-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const short = btn.parentElement.querySelector('.note-short')
      const full = btn.parentElement.querySelector('.note-full')
      if (full.classList.contains('hidden')) {
        full.textContent = btn.dataset.full
        full.classList.remove('hidden')
        short.classList.add('hidden')
        btn.textContent = 'Show less'
      } else {
        full.classList.add('hidden')
        short.classList.remove('hidden')
        btn.textContent = 'Read more'
      }
    })
  })
}

async function showTransactionForm(editTxn, party, sources, allTxns, container, navigate, presetType, ledgerId) {
  const isEdit = !!editTxn
  const txnType = isEdit ? editTxn.type : presetType
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  const sourceAllocHtml = activeSources.length > 0 ? `
    <div>
      <label class="input-label">Money Source Allocation</label>
      <div class="space-y-2" id="source-allocs">
        ${activeSources.map((s) => {
          const alloc = editTxn?.sourceAllocations?.find((a) => a.sourceId === s._id)
          const checked = alloc ? 'checked' : (!editTxn && s === activeSources[0] ? 'checked' : '')
          const amount = alloc ? alloc.amount : ''
          const disabled = alloc ? '' : (!editTxn && s === activeSources[0] ? '' : 'disabled')
          return `
            <div class="flex items-center gap-2">
              <input type="checkbox" id="alloc-src-${s._id}" class="rounded border-gray-300 text-primary focus:ring-primary src-check" data-id="${s._id}" ${checked} />
              <label for="alloc-src-${s._id}" class="text-sm flex-1">${s.name}</label>
              <input type="number" step="0.01" class="input w-28 text-sm alloc-amount" data-id="${s._id}" placeholder="Amount" value="${amount}" ${disabled} />
            </div>
          `
        }).join('')}
      </div>
    </div>
  ` : ''

  const typeLabels = { debit: 'Debit (Give)', credit: 'Credit (Return)' }

  const content = `
    <div class="space-y-3">
      <p class="text-sm font-semibold ${txnType === 'debit' ? 'text-red-600' : 'text-green-600'}">${typeLabels[txnType]}</p>
      ${sourceAllocHtml}
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="txn-amount" type="number" step="0.01" value="${editTxn?.amount || ''}" placeholder="0.00" ${activeSources.length > 0 ? 'readonly' : ''} />
        <p class="text-xs text-gray-400 mt-1" id="amount-hint">${activeSources.length > 0 ? 'Auto-calculated from source allocation sums. Edit manually to override and clear allocations.' : ''}</p>
      </div>
      <div>
        <label class="input-label">Date</label>
        ${dateInputHTML({id: 'txn-date', value: editTxn?.date?.split('T')[0] || new Date().toISOString().split('T')[0]})}
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="txn-notes" rows="3" placeholder="Transaction notes">${escHtml(editTxn?.notes || '')}</textarea>
      </div>
      <div>
        <label class="input-label">Tags (comma separated)</label>
        <input class="input" id="txn-tags" value="${editTxn?.tags || ''}" placeholder="e.g. urgent, monthly" />
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Transaction' : `New ${typeLabels[txnType]}`,
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onMounted: () => {
      setupDateInput('txn-date')
      const allocs = document.getElementById('source-allocs')
      if (!allocs) return

      function updateAmountFromAllocs() {
        let sum = 0
        document.querySelectorAll('.alloc-amount:not([disabled])').forEach((inp) => {
          sum += parseFloat(inp.value) || 0
        })
        const amountInput = document.getElementById('txn-amount')
        if (amountInput) amountInput.value = sum > 0 ? sum.toFixed(2) : ''
      }

      function enableAutoAmount() {
        const a = document.getElementById('txn-amount')
        if (a && !a.hasAttribute('readonly')) {
          a.setAttribute('readonly', '')
        }
        updateAmountFromAllocs()
      }

      allocs.addEventListener('input', (e) => {
        if (e.target.classList.contains('alloc-amount')) enableAutoAmount()
      })

      allocs.addEventListener('change', (e) => {
        if (e.target.classList.contains('src-check')) {
          const input = document.querySelector(`.alloc-amount[data-id="${e.target.dataset.id}"]`)
          if (input) {
            input.disabled = !e.target.checked
            if (!e.target.checked) input.value = ''
          }
          enableAutoAmount()
        }
      })

      document.getElementById('txn-amount')?.addEventListener('focus', function () {
        if (!this.hasAttribute('readonly')) return
        this.removeAttribute('readonly')
        document.querySelectorAll('.src-check:checked').forEach((cb) => {
          cb.checked = false
          const inp = document.querySelector(`.alloc-amount[data-id="${cb.dataset.id}"]`)
          if (inp) { inp.disabled = true; inp.value = '' }
        })
        document.getElementById('amount-hint')?.classList.add('hidden')
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
        ledgerId,
        category: 'principal',
        type: txnType,
        amount,
        date: getDateInputValue('txn-date') || new Date().toISOString(),
        tags: document.getElementById('txn-tags')?.value.trim() || '',
        notes: document.getElementById('txn-notes')?.value.trim() || '',
        sourceAllocations: sourceAllocations.length > 0 ? sourceAllocations : undefined,
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  if (isEdit) {
    result._id = editTxn._id
    const interestCharges = allTxns.filter((t) => t.category === 'interest' && t.type === 'charge' && t.partyId === party._id && t.ledgerId === ledgerId)
    if (interestCharges.length > 0) {
      const confirmed = await showConfirm({
        title: 'Interest May Be Affected',
        message: `Editing this transaction may affect ${interestCharges.length} existing interest charge(s). They will be removed and you will need to recalculate interest later. Continue?`,
        confirmText: 'Edit & Remove Charges',
        danger: true,
      })
      if (!confirmed) return
      for (const charge of interestCharges) {
        await deleteTransaction(charge._id)
      }
      logAction('delete', 'transaction', party._id, `Deleted ${interestCharges.length} interest charges due to principal transaction edit`)
    }
  }

  await saveTransaction(result)
  logAction(isEdit ? 'update' : 'create', 'transaction', result._id || '', `${isEdit ? 'Updated' : 'Added'} ${result.type} principal transaction of ${result.amount}`)
  showToast(isEdit ? 'Transaction updated' : 'Transaction added')
  renderPartyDetail(container, navigate, { id: party._id })
}

async function showInterestChargeForm(party, allTxns, sources, container, navigate, ledgerId, ledger) {
  const lastChargeDate = getLastInterestChargeDate(allTxns)
  const firstPrincipalDate = getFirstPrincipalDate(allTxns)

  const fromDate = lastChargeDate ? (() => {
    const d = new Date(lastChargeDate + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  })() : (firstPrincipalDate || party.createdAt?.split('T')[0])

  const today = new Date().toISOString().split('T')[0]

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Calculate Interest Up To</label>
        ${dateInputHTML({id: 'calc-to-date', value: today})}
      </div>
      <p class="text-xs text-gray-400">Interest will be calculated from <strong>${fromDate}</strong> to the selected date at <strong>${ledger.interestRate}%/mo</strong>.</p>
      ${!fromDate ? '<p class="text-xs text-amber-600">No starting date available.</p>' : ''}
    </div>
  `

  const result = await showModal({
    title: 'Calculate Interest',
    content,
    confirmText: 'Calculate',
    onMounted: () => {
      setupDateInput('calc-to-date')
    },
    onConfirm: () => {
      const toDate = getDateInputValue('calc-to-date')
      if (!toDate) { showToast('Please select a date', 'error'); return false }

      if (!fromDate) return false

      const charges = calculateMonthlyCharges({
        transactions: allTxns,
        rate: ledger.interestRate,
        fromDate,
        toDate,
      })

      if (charges.length === 0) {
        if (!ledger.interestRate || ledger.interestRate <= 0) {
          showToast('Interest rate is 0%. Set an interest rate for this ledger.', 'error')
        } else {
          showToast('No interest accrued in this period', 'error')
        }
        return false
      }

      return { charges, fromDate, toDate }
    },
  })

  if (!result || result === true) return
  const { charges, fromDate: actualFromDate, toDate: actualToDate } = result
  if (!charges || charges.length === 0) return

  const totalInterest = charges.reduce((s, c) => s + c.amount, 0)
  const data = {
    partyId: party._id,
    ledgerId,
    category: 'interest',
    type: 'charge',
    amount: Math.round(totalInterest * 100) / 100,
    date: actualToDate,
    notes: `Interest charged from ${formatDate(actualFromDate)} to ${formatDate(actualToDate)}`,
    breakdown: charges,
    updatedAt: new Date().toISOString(),
  }

  await saveTransaction(data)
  logAction('create', 'transaction', party._id, `Calculated interest of ${data.amount} for ${party.name}`)
  showToast(`Interest of ${formatCurrencyFull(data.amount)} charged`)
  renderPartyDetail(container, navigate, { id: party._id, ledgerId })
}

async function showInterestPaymentForm(party, allTxns, sources, container, navigate, ledgerId) {
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  const sourceAllocHtml = activeSources.length > 0 ? `
    <div>
      <label class="input-label">Money Source Allocation</label>
      <div class="space-y-2" id="pay-source-allocs">
        ${activeSources.map((s, i) => `
          <div class="flex items-center gap-2">
            <input type="checkbox" id="pay-alloc-src-${s._id}" class="rounded border-gray-300 text-primary focus:ring-primary pay-src-check" data-id="${s._id}" ${i === 0 ? 'checked' : ''} />
            <label for="pay-alloc-src-${s._id}" class="text-sm flex-1">${s.name}</label>
            <input type="number" step="0.01" class="input w-28 text-sm pay-alloc-amount" data-id="${s._id}" placeholder="Amount" ${i === 0 ? '' : 'disabled'} />
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''

  const content = `
    <div class="space-y-3">
      ${sourceAllocHtml}
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="pay-amount" type="number" step="0.01" placeholder="0.00" ${activeSources.length > 0 ? 'readonly' : ''} />
        <p class="text-xs text-gray-400 mt-1" id="pay-amount-hint">${activeSources.length > 0 ? 'Auto-calculated from source allocation sums. Edit manually to override and clear allocations.' : ''}</p>
      </div>
      <div>
        <label class="input-label">Date</label>
        ${dateInputHTML({id: 'pay-date', value: new Date().toISOString().split('T')[0]})}
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="pay-notes" rows="3" placeholder="Optional notes"></textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Record Interest Payment',
    content,
    confirmText: 'Record',
    onMounted: () => {
      setupDateInput('pay-date')
      const allocs = document.getElementById('pay-source-allocs')
      if (!allocs) return

      function updateAmountFromAllocs() {
        let sum = 0
        document.querySelectorAll('.pay-alloc-amount:not([disabled])').forEach((inp) => {
          sum += parseFloat(inp.value) || 0
        })
        const amountInput = document.getElementById('pay-amount')
        if (amountInput) amountInput.value = sum > 0 ? sum.toFixed(2) : ''
      }

      function enableAutoAmount() {
        const a = document.getElementById('pay-amount')
        if (a && !a.hasAttribute('readonly')) a.setAttribute('readonly', '')
        updateAmountFromAllocs()
      }

      allocs.addEventListener('input', (e) => {
        if (e.target.classList.contains('pay-alloc-amount')) enableAutoAmount()
      })

      allocs.addEventListener('change', (e) => {
        if (e.target.classList.contains('pay-src-check')) {
          const input = document.querySelector(`.pay-alloc-amount[data-id="${e.target.dataset.id}"]`)
          if (input) {
            input.disabled = !e.target.checked
            if (!e.target.checked) input.value = ''
          }
          enableAutoAmount()
        }
      })

      document.getElementById('pay-amount')?.addEventListener('focus', function () {
        if (!this.hasAttribute('readonly')) return
        this.removeAttribute('readonly')
        document.querySelectorAll('.pay-src-check:checked').forEach((cb) => {
          cb.checked = false
          const inp = document.querySelector(`.pay-alloc-amount[data-id="${cb.dataset.id}"]`)
          if (inp) { inp.disabled = true; inp.value = '' }
        })
        document.getElementById('pay-amount-hint')?.classList.add('hidden')
      })
    },
    onConfirm: () => {
      const amount = parseFloat(document.getElementById('pay-amount')?.value)
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }

      const sourceAllocations = []
      document.querySelectorAll('.pay-src-check:checked').forEach((cb) => {
        const input = document.querySelector(`.pay-alloc-amount[data-id="${cb.dataset.id}"]`)
        const val = parseFloat(input?.value) || 0
        if (val > 0) sourceAllocations.push({ sourceId: cb.dataset.id, amount: val })
      })

      return {
        partyId: party._id,
        ledgerId,
        category: 'interest',
        type: 'payment',
        amount,
        date: getDateInputValue('pay-date') || new Date().toISOString(),
        notes: document.getElementById('pay-notes')?.value.trim() || 'Interest payment',
        sourceAllocations: sourceAllocations.length > 0 ? sourceAllocations : undefined,
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  await saveTransaction(result)
  const srcAllocs = result.sourceAllocations || []
  if (srcAllocs.length > 0) {
    const paymentDate = result.date
    for (const alloc of srcAllocs) {
      await saveSourceTransaction({
        sourceId: alloc.sourceId,
        type: 'credit',
        amount: alloc.amount,
        date: paymentDate,
        description: `Interest payment from ${party.name}`,
      })
    }
  }
  logAction('create', 'transaction', result._id || '', `Recorded interest payment of ${result.amount}`)
  showToast('Interest payment recorded')
  renderPartyDetail(container, navigate, { id: party._id, ledgerId })
}

async function showCollateralForm(editCollateral, partyId, collaterals, party, allTxns, sources, container, navigate, ledgerId) {
  const isEdit = !!editCollateral
  let imageData = editCollateral?.image || ''
  let selectedFile = null

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Photo</label>
        <div class="flex items-center gap-3">
          <input type="file" accept="image/*" id="col-image" class="hidden" />
          <button class="btn-outline text-sm" id="col-image-btn"><ion-icon name="camera-outline" class="mr-1"></ion-icon>Choose Photo</button>
          ${imageData ? `<img src="${imageData}" class="w-14 h-14 rounded-lg object-cover" />` : '<div id="col-image-preview" class="hidden"></div>'}
        </div>
      </div>
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
          <option value="held" ${editCollateral?.status === 'held' || !editCollateral ? 'selected' : ''}>In Possession</option>
          <option value="released" ${editCollateral?.status === 'released' ? 'selected' : ''}>Returned</option>
        </select>
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="col-notes" rows="3">${escHtml(editCollateral?.notes || '')}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Collateral' : 'Add Collateral',
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onMounted: () => {
      document.getElementById('col-image-btn')?.addEventListener('click', () => {
        document.getElementById('col-image')?.click()
      })
      document.getElementById('col-image')?.addEventListener('change', (e) => {
        const file = e.target.files[0]
        if (!file) return
        selectedFile = file
        const reader = new FileReader()
        reader.onload = (ev) => {
          imageData = ev.target.result
          const preview = document.getElementById('col-image-preview')
          if (preview) {
            preview.innerHTML = `<img src="${imageData}" class="w-14 h-14 rounded-lg object-cover" />`
            preview.classList.remove('hidden')
          }
        }
        reader.readAsDataURL(file)
      })
    },
    onConfirm: () => {
      const desc = document.getElementById('col-desc')?.value.trim()
      if (!desc) { showToast('Description is required', 'error'); return false }
      const result = {
        partyId,
        ledgerId,
        type: document.getElementById('col-type')?.value || 'other',
        description: desc,
        serialNumber: document.getElementById('col-serial')?.value.trim() || '',
        weight: document.getElementById('col-weight')?.value.trim() || '',
        estimatedValue: parseFloat(document.getElementById('col-value')?.value) || 0,
        status: document.getElementById('col-status')?.value || 'held',
        notes: document.getElementById('col-notes')?.value.trim() || '',
        lastUpdated: new Date().toISOString(),
      }
      if (selectedFile) result._imageFile = selectedFile
      if (isEdit) result._id = editCollateral._id
      return result
    },
  })

  if (!result || result === true) return
  if (!result._id) result._id = editCollateral?._id

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

  document.getElementById('menu-delete')?.addEventListener('click', async () => {
    document.querySelector('[data-dismiss]')?.click()
    const confirmed = await showConfirm({ title: 'Delete Party?', message: 'This will permanently delete this party and all their transactions.', confirmText: 'Delete', danger: true })
    if (confirmed) {
      for (const t of allTxns) await deleteTransaction(t._id)
      for (const c of await getCollaterals(party._id)) await deleteCollateral(c._id)
      for (const l of await getLedgers(party._id)) await deleteLedger(l._id)
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
        <textarea class="input" id="pf-address" rows="3">${escHtml(party?.address || '')}</textarea>
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
        <label class="input-label">Notes</label>
        <textarea class="input" id="pf-notes" rows="3">${escHtml(party?.notes || '')}</textarea>
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
