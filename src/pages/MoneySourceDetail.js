import { getMoneySource, saveMoneySource, getAllTransactions, getSourceTransactions, saveSourceTransaction, deleteSourceTransaction, getParties, getMoneySources, saveSourceTransfer } from '../db/database.js'
import { formatCurrency, formatCurrencyPrecise, formatDate, sourceTypeIcon } from '../utils/formatters.js'
import { dateInputHTML, setupDateInput, getDateInputValue, setDateInputValue } from '../utils/dateInput.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { escHtml } from '../utils/helpers.js'

let _source, _allTxns, _sourceTxns, _allParties, _container, _navigate, _params

export async function renderMoneySourceDetail(container, navigate, params) {
  _page = 1
  _perPage = 10
  _filterDateFrom = ''
  _filterDateTo = ''
  _filterParty = ''

  const removeLoader = showSkeleton(container)
  const [source, allTxns, sourceTxns, allParties] = await Promise.all([
    getMoneySource(params.id),
    getAllTransactions(),
    getSourceTransactions(params.id),
    getParties(),
  ])
  removeLoader()

  if (!source) {
    container.innerHTML = '<div class="empty-state"><p>Source not found</p></div>'
    return
  }

  _source = source; _allTxns = allTxns; _sourceTxns = sourceTxns; _allParties = allParties; _container = container; _navigate = navigate; _params = params

  const { balance, lentOut, repaidToSource } = getDerived()

  renderHeader(source.name, {
    onBack: () => navigate('money-sources'),
  })

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div class="card-flat">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-${source.type === 'cash' ? 'green' : source.type === 'bank' ? 'blue' : source.type === 'partner' ? 'purple' : 'gray'}-50 flex items-center justify-center text-${source.type === 'cash' ? 'green' : source.type === 'bank' ? 'blue' : source.type === 'partner' ? 'purple' : 'gray'}-600">
            <ion-icon name="${sourceTypeIcon(source.type)}" class="text-lg"></ion-icon>
          </div>
          <div>
            <div class="font-bold text-lg">${source.name}</div>
            <div class="text-xs text-gray-400 capitalize">${source.type}${source.owner ? ' · ' + source.owner : ''}</div>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div id="balance-stat" class="cursor-pointer active:scale-95 transition-transform">
            <div class="stat-label">Balance</div>
            <div class="stat-value text-primary">${formatCurrency(balance)}</div>
          </div>
          <div>
            <div class="stat-label">Lent Out</div>
            <div class="stat-value text-amber-600">${formatCurrency(lentOut)}</div>
          </div>
          <div>
            <div class="stat-label">Repaid</div>
            <div class="stat-value text-green-600">${formatCurrency(repaidToSource)}</div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between mb-2.5">
        <h3 class="font-bold text-sm">Ledger</h3>
        <div class="flex gap-2">
          <button class="btn-outline btn-sm" id="transfer-btn"><ion-icon name="swap-horizontal-outline" class="text-sm"></ion-icon></button>
          <button class="btn-outline btn-sm" id="filter-ledger"><ion-icon name="funnel-outline" class="text-sm"></ion-icon></button>
          <button class="btn-outline btn-sm" id="report-ledger"><ion-icon name="download-outline" class="text-sm"></ion-icon></button>
        </div>
      </div>
      <div class="flex gap-2 mb-3">
        <button class="flex-1 text-sm font-semibold py-2.5 rounded-xl border-2 border-red-200 text-red-600 bg-red-50 active:bg-red-100 active:scale-[0.97] transition-all" id="add-debit-entry">Debit (Money Out)</button>
        <button class="flex-1 text-sm font-semibold py-2.5 rounded-xl border-2 border-green-200 text-green-600 bg-green-50 active:bg-green-100 active:scale-[0.97] transition-all" id="add-credit-entry">Credit (Money In)</button>
      </div>

      <div id="ledger-filters" class="flex flex-wrap gap-2 hidden"></div>

      <div id="ledger-controls" class="flex items-center justify-between"></div>

      <div id="source-ledger" class="space-y-1"></div>
    </div>
  `

  document.getElementById('add-debit-entry').addEventListener('click', () => showSourceTxnForm(source._id, container, navigate, 'debit'))
  document.getElementById('add-credit-entry').addEventListener('click', () => showSourceTxnForm(source._id, container, navigate, 'credit'))
  document.getElementById('transfer-btn').addEventListener('click', () => showSourceTransferForm(source._id, container, navigate))
  document.getElementById('report-ledger').addEventListener('click', () => showReportForm(source._id, navigate))
  document.getElementById('filter-ledger').addEventListener('click', () => {
    document.getElementById('ledger-filters').classList.toggle('hidden')
    if (!document.getElementById('ledger-filters').classList.contains('hidden')) {
      renderLedger()
    }
  })
  document.getElementById('balance-stat').addEventListener('click', showPreciseBalance)

  renderLedger()
}

function showPreciseBalance() {
  const existing = document.getElementById('precise-balance-toast')
  if (existing) existing.remove()
  const { balance } = getDerived()
  const el = document.createElement('div')
  el.id = 'precise-balance-toast'
  el.className = 'card-flat bg-gradient-to-r from-primary/5 to-vibgyor-violet/5 animate-fade-in'
  el.innerHTML = `<div class="flex items-center justify-between"><span class="text-sm text-gray-500 font-medium">Net Balance</span><span class="font-mono text-lg font-bold text-primary">${formatCurrencyPrecise(balance)}</span></div>`
  const summary = document.querySelector('.card-flat')
  summary.parentNode.insertBefore(el, summary.nextSibling)
  setTimeout(() => { const e = document.getElementById('precise-balance-toast'); if (e) e.remove() }, 7000)
}

function getDerived() {
  const principalTxns = _allTxns.filter((t) => {
    if (!t.sourceAllocations || t.category === 'interest') return false
    return t.sourceAllocations.some((a) => a.sourceId === _source._id)
  }).sort((a, b) => new Date(a.date) - new Date(b.date))

  const totalSourceCredits = _sourceTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const totalSourceDebits = _sourceTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
  const totalLoansGiven = principalTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === _source._id)?.amount || 0), 0)
  const totalRepayments = principalTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === _source._id)?.amount || 0), 0)
  const balance = (_source.openingBalance || 0) + totalSourceCredits - totalSourceDebits - totalLoansGiven + totalRepayments

  return { principalTxns, balance, lentOut: totalLoansGiven, repaidToSource: totalRepayments }
}

function buildEntries() {
  const { principalTxns } = getDerived()
  const entries = [
    ..._sourceTxns.map((t) => ({ ...t, entryType: 'source' })),
    ...principalTxns.map((t) => {
      const party = _allParties.find((p) => p._id === t.partyId)
      return { ...t, entryType: 'principal', description: `${t.type === 'debit' ? 'Loan given' : 'Repayment'} — ${party?.name || t.partyId}` }
    }),
  ]
  entries.sort((a, b) => new Date(a.date) - new Date(b.date))
  return entries
}

let _page = 1
let _perPage = 10
let _filterDateFrom = ''
let _filterDateTo = ''
let _filterParty = ''

function renderLedger() {
  const { balance } = getDerived()
  const entries = buildEntries()
  const opening = _source.openingBalance || 0

  let filtered = [...entries]
  if (_filterDateFrom) filtered = filtered.filter((e) => e.date >= _filterDateFrom)
  if (_filterDateTo) filtered = filtered.filter((e) => e.date <= _filterDateTo)
  if (_filterParty) {
    filtered = filtered.filter((e) => {
      if (e.entryType === 'source') return false
      const party = _allParties.find((p) => p._id === e.partyId)
      return party?._id === _filterParty || party?.name === _filterParty
    })
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / _perPage))
  if (_page > totalPages) _page = totalPages
  const start = (_page - 1) * _perPage
  const pageEntries = filtered.slice(start, start + _perPage)

  const partiesInLedger = [...new Set(entries.filter((e) => e.entryType === 'principal').map((e) => {
    const party = _allParties.find((p) => p._id === e.partyId)
    return party ? { id: party._id, name: party.name } : null
  }).filter(Boolean).map((p) => p.id))].map((id) => _allParties.find((p) => p._id === id)).filter(Boolean)

  const filterEl = document.getElementById('ledger-filters')
  filterEl.innerHTML = `
    <div class="flex items-center gap-1.5 flex-wrap w-full">
      ${dateInputHTML({id: 'filter-date-from', value: _filterDateFrom, cls: 'w-[130px]'})}
      <span class="text-xs text-gray-400">to</span>
      ${dateInputHTML({id: 'filter-date-to', value: _filterDateTo, cls: 'w-[130px]'})}
      <select class="input text-xs py-1 px-2 w-auto" id="filter-party">
        <option value="">All Parties</option>
        ${partiesInLedger.map((p) => `<option value="${p._id}" ${_filterParty === p._id ? 'selected' : ''}>${p.name}</option>`).join('')}
      </select>
      ${(_filterDateFrom || _filterDateTo || _filterParty) ? '<button class="text-xs text-primary ml-1" id="clear-filters">Clear</button>' : ''}
    </div>
  `

  setupDateInput('filter-date-from')
  setupDateInput('filter-date-to')

  document.getElementById('filter-date-from')?.addEventListener('change', () => { _filterDateFrom = getDateInputValue('filter-date-from'); _page = 1; renderLedger() })
  document.getElementById('filter-date-to')?.addEventListener('change', () => { _filterDateTo = getDateInputValue('filter-date-to'); _page = 1; renderLedger() })
  document.getElementById('filter-party')?.addEventListener('change', (e) => { _filterParty = e.target.value; _page = 1; renderLedger() })
  document.getElementById('clear-filters')?.addEventListener('click', () => { _filterDateFrom = ''; _filterDateTo = ''; _filterParty = ''; _page = 1; renderLedger() })

  const controlsEl = document.getElementById('ledger-controls')
  controlsEl.innerHTML = `
    <div class="flex items-center gap-2">
      <select class="input text-xs py-1 px-2 w-auto" id="per-page">
        ${[10, 25, 50, 100].map((n) => `<option value="${n}" ${_perPage === n ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      <span class="text-xs text-gray-400">per page</span>
    </div>
    <div class="flex items-center gap-2">
      <button class="text-xs px-2 py-1 rounded border border-gray-200 ${_page <= 1 ? 'opacity-30' : ''}" id="page-prev" ${_page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="text-xs text-gray-500">${_page}/${totalPages}</span>
      <button class="text-xs px-2 py-1 rounded border border-gray-200 ${_page >= totalPages ? 'opacity-30' : ''}" id="page-next" ${_page >= totalPages ? 'disabled' : ''}>Next</button>
      <span class="text-xs text-gray-400 ml-1">(${filtered.length} entries)</span>
    </div>
  `

  document.getElementById('per-page')?.addEventListener('change', (e) => { _perPage = parseInt(e.target.value); _page = 1; renderLedger() })
  document.getElementById('page-prev')?.addEventListener('click', () => { if (_page > 1) { _page--; renderLedger() } })
  document.getElementById('page-next')?.addEventListener('click', () => { if (_page < totalPages) { _page++; renderLedger() } })

  const el = document.getElementById('source-ledger')

  let running = opening

  const openingRow = `
    <div class="flex items-start justify-between py-2.5 border-b border-gray-50 opacity-70">
      <div class="flex-1 min-w-0">
        <div class="text-xs text-gray-400">${formatDate(_source.createdAt || _source.updatedAt)}</div>
        <div class="text-sm font-semibold truncate">Opening Balance</div>
      </div>
      <div class="text-right ml-3">
        <div class="font-mono text-sm font-semibold">${formatCurrencyPrecise(opening)}</div>
        <div class="font-mono text-xs text-gray-400">${formatCurrencyPrecise(running)}</div>
      </div>
    </div>
  `

  if (pageEntries.length === 0 && start === 0) {
    el.innerHTML = openingRow + '<p class="text-xs text-gray-400 text-center py-4">No ledger entries yet.</p>'
    return
  }

  let html = openingRow

  const filteredSet = new Set(filtered)

  for (const e of entries) {
    let displayAmount = e.amount
    if (e.entryType === 'principal') {
      displayAmount = e.sourceAllocations?.find((a) => a.sourceId === _source._id)?.amount || 0
    }
    running += e.type === 'credit' ? displayAmount : -displayAmount
    if (!filteredSet.has(e)) continue
    if (pageEntries.indexOf(e) === -1) continue
    const isSourceEntry = e.entryType === 'source'

    html += `
      <div class="flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="text-xs text-gray-400">${formatDate(e.date)}</div>
          <div class="text-sm truncate">${e.description}</div>
          ${isSourceEntry && e._id ? `
            <div class="flex gap-2 mt-1">
              <button class="text-xs text-red-400 delete-srctxn" data-id="${e._id}" data-source="${_source._id}">Delete</button>
            </div>
          ` : ''}
        </div>
        <div class="text-right ml-3">
          ${e.type === 'debit' ? `<div class="font-mono text-sm text-red-500">-${formatCurrencyPrecise(displayAmount)}</div>` :
            `<div class="font-mono text-sm text-green-600">+${formatCurrencyPrecise(displayAmount)}</div>`
          }
          <div class="font-mono text-xs text-gray-400">${formatCurrencyPrecise(running)}</div>
        </div>
      </div>
    `
  }

  el.innerHTML = html

  el.querySelectorAll('.delete-srctxn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({ title: 'Delete Entry?', message: 'This will permanently remove this ledger entry.', confirmText: 'Delete', danger: true })
      if (!confirmed) return
      await deleteSourceTransaction(btn.dataset.id)
      logAction('delete', 'source_transaction', btn.dataset.id, 'Deleted source ledger entry')
      showToast('Entry deleted')
      const [_src, _all, _srcTxns, _parties] = await Promise.all([
        getMoneySource(_params.id),
        getAllTransactions(),
        getSourceTransactions(_params.id),
        getParties(),
      ])
      _source = _src; _allTxns = _all; _sourceTxns = _srcTxns; _allParties = _parties
      _page = 1
      renderLedger()
    })
  })
}

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function getFinancialYearRange() {
  const now = new Date()
  const y = now.getFullYear()
  const aprStart = new Date(y, 3, 1)
  const start = now < aprStart ? new Date(y - 1, 3, 1) : aprStart
  const end = now < aprStart ? new Date(y, 2, 31) : new Date(y + 1, 2, 31)
  return {
    from: fmt(start),
    to: fmt(end),
    label: `${start.getFullYear()}-${end.getFullYear()}`
  }
}

function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

async function showReportForm(sourceId, navigate) {
  const fy = getFinancialYearRange()
  const today = new Date().toISOString().split('T')[0]

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Date Range</label>
        <div class="flex items-center gap-2">
          ${dateInputHTML({id: 'rpt-from', value: monthsAgo(3), cls: 'flex-1'})}
          <span class="text-xs text-gray-400">to</span>
          ${dateInputHTML({id: 'rpt-to', value: today, cls: 'flex-1'})}
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 quick-range" data-from="${fy.from}" data-to="${fy.to}">FY ${fy.label}</button>
        <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 quick-range" data-from="${monthsAgo(3)}" data-to="${today}">Last 3 months</button>
        <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 quick-range" data-from="${monthsAgo(6)}" data-to="${today}">Last 6 months</button>
        <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 quick-range" data-from="${monthsAgo(12)}" data-to="${today}">Last 1 year</button>
        <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 quick-range" data-from="" data-to="">All Time</button>
      </div>
      <div class="text-xs text-gray-400">CSV will include: Date, Party, Debit, Credit, Cumulative Balance, Description</div>
    </div>
  `

  const result = await showModal({
    title: 'Download CSV Report',
    content,
    confirmText: 'Download',
    onMounted: () => {
      setupDateInput('rpt-from')
      setupDateInput('rpt-to')
      document.querySelectorAll('.quick-range').forEach((btn) => {
        btn.addEventListener('click', () => {
          setDateInputValue('rpt-from', btn.dataset.from)
          setDateInputValue('rpt-to', btn.dataset.to)
        })
      })
    },
    onConfirm: () => {
      const from = getDateInputValue('rpt-from')
      const to = getDateInputValue('rpt-to')
      if (!from || !to) { showToast('Please select a date range', 'error'); return false }
      return { from, to }
    },
  })

  if (!result || result === true) return

  generateCSV(sourceId, result.from, result.to, navigate)
}

function generateCSV(sourceId, from, to) {
  const allEntries = buildEntries()
  const opening = _source.openingBalance || 0

  const filtered = allEntries.filter((e) => {
    if (from && e.date < from) return false
    if (to && e.date > to) return false
    return true
  })

  let running = opening
  for (const e of allEntries) {
    if (e.date >= from) break
    const amt = e.entryType === 'principal'
      ? (e.sourceAllocations?.find((a) => a.sourceId === _source._id)?.amount || 0)
      : e.amount
    running += e.type === 'credit' ? amt : -amt
  }

  const header = 'Date,Party,Debit,Credit,Date,Cumulative,Tx Description'
  const rows = []
  const txt = (s) => '"' + String(s).replace(/"/g, '""') + '"'
  const fromDateStr = formatDate(from)

  rows.push([txt(fromDateStr), txt(''), '', '', txt(fromDateStr), running, txt('Opening Balance')].join(','))

  for (const e of filtered) {
    let displayAmount = e.amount
    if (e.entryType === 'principal') {
      displayAmount = e.sourceAllocations?.find((a) => a.sourceId === _source._id)?.amount || 0
    }

    running += e.type === 'credit' ? displayAmount : -displayAmount

    const party = e.entryType === 'principal' ? (_allParties.find((p) => p._id === e.partyId)?.name || '') : ''
    const debit = e.type === 'debit' ? displayAmount : ''
    const credit = e.type === 'credit' ? displayAmount : ''
    const cumulative = running
    const dateStr = formatDate(e.date)
    const desc = e.description || ''

    rows.push([txt(dateStr), txt(party), debit, credit, txt(dateStr), cumulative, txt(desc)].join(','))
  }

  const csv = '\uFEFF' + header + '\n' + rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${_source.name.replace(/[^a-zA-Z0-9]/g, '_')}_ledger_${from}_to_${to}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('Report downloaded')
}

async function showSourceTxnForm(sourceId, container, navigate, presetType) {
  const typeLabels = { debit: 'Debit (Money Out)', credit: 'Credit (Money In)' }
  const content = `
    <div class="space-y-3">
      <p class="text-sm font-semibold ${presetType === 'debit' ? 'text-red-600' : 'text-green-600'}">${typeLabels[presetType]}</p>
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="stxn-amount" type="number" step="0.01" placeholder="0.00" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        ${dateInputHTML({id: 'stxn-date', value: new Date().toISOString().split('T')[0]})}
      </div>
      <div>
        <label class="input-label">Description *</label>
        <input class="input" id="stxn-desc" placeholder="e.g. Bank interest charged, Cash deposited, Tax paid" />
      </div>
    </div>
  `

  const result = await showModal({
    title: `New ${typeLabels[presetType]}`,
    content,
    confirmText: 'Add',
    onMounted: () => {
      setupDateInput('stxn-date')
    },
    onConfirm: () => {
      const amount = parseFloat(document.getElementById('stxn-amount')?.value)
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }
      const desc = document.getElementById('stxn-desc')?.value.trim()
      if (!desc) { showToast('Description is required', 'error'); return false }
      return {
        sourceId,
        type: presetType,
        amount,
        date: getDateInputValue('stxn-date') || new Date().toISOString(),
        description: desc,
      }
    },
  })

  if (!result || result === true) return

  await saveSourceTransaction(result)
  logAction('create', 'source_transaction', result._id || '', `Added ${result.type} entry of ${result.amount} to source ledger`)
  showToast('Ledger entry added')

  const [_src, _all, _srcTxns, _parties] = await Promise.all([
    getMoneySource(sourceId),
    getAllTransactions(),
    getSourceTransactions(sourceId),
    getParties(),
  ])
  _source = _src; _allTxns = _all; _sourceTxns = _srcTxns; _allParties = _parties
  _page = 1
  renderLedger()
}

async function showSourceTransferForm(sourceId, container, navigate) {
  const allSources = await getMoneySources()
  const activeSources = allSources.filter((s) => s.status !== 'inactive')
  const currentSource = allSources.find((s) => s._id === sourceId)

  const toOpts = activeSources.map((s) =>
    `<option value="${s._id}" ${s._id === sourceId ? 'disabled' : ''}>${escHtml(s.name)}${s.owner ? ' (' + escHtml(s.owner) + ')' : ''}</option>`
  ).join('')

  const content = `
    <div class="space-y-3">
      <p class="text-sm font-semibold text-gray-600">From: ${escHtml(currentSource?.name || '')}</p>
      <div>
        <label class="input-label">Select Target Source *</label>
        <select class="input" id="stf-to">
          <option value="">-- Select --</option>
          ${toOpts}
        </select>
      </div>
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="stf-amount" type="number" step="0.01" placeholder="0.00" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        ${dateInputHTML({id: 'stf-date', value: new Date().toISOString().split('T')[0]})}
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="stf-notes" rows="2" placeholder="Optional reference"></textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Transfer Money',
    content,
    confirmText: 'Transfer',
    onMounted: () => {
      setupDateInput('stf-date')
    },
    onConfirm: () => {
      const toId = document.getElementById('stf-to')?.value
      const amount = parseFloat(document.getElementById('stf-amount')?.value)
      const date = getDateInputValue('stf-date')
      const notes = document.getElementById('stf-notes')?.value.trim() || ''

      if (!toId) { showToast('Select target source', 'error'); return false }
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }
      if (!date) { showToast('Select date', 'error'); return false }

      const toSrc = allSources.find((s) => s._id === toId)

      return {
        fromSourceId: sourceId,
        toSourceId: toId,
        amount,
        date,
        notes,
        sourceNames: { from: currentSource?.name || '', to: toSrc?.name || '' },
      }
    },
  })

  if (!result || result === true) return

  try {
    await saveSourceTransfer(result)
    logAction('create', 'source_transfer', '', `Transferred ${result.amount} from ${result.sourceNames.from} to ${result.sourceNames.to}`)
    showToast('Transfer recorded')
    const [_src, _all, _srcTxns, _parties] = await Promise.all([
      getMoneySource(sourceId),
      getAllTransactions(),
      getSourceTransactions(sourceId),
      getParties(),
    ])
    _source = _src; _allTxns = _all; _sourceTxns = _srcTxns; _allParties = _parties
    _page = 1
    renderLedger()
  } catch (err) {
    showToast('Error recording transfer: ' + err.message, 'error')
  }
}
