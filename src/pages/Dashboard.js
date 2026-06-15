import { getMoneySources, getParties, getAllTransactions, getAllSourceTransactions, getCollaterals, getLedgers } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDateShort, formatDate } from '../utils/formatters.js'
import { getOutstandingForParty, calculateMonthlyCharges, getLastInterestChargeDate, getFirstPrincipalDate } from '../services/interest.js'
import { saveTransaction, deleteTransaction } from '../db/database.js'
import { logAction } from '../services/audit.js'
import { generateInterestReport, renderReportOverlay } from './InterestReport.js'
import { generateTaxReport, renderTaxReportOverlay } from './TaxReport.js'
import { generatePartnerTransferReport, renderPartnerTransferReportOverlay } from './PartnerTransferReport.js'
import { renderHeader } from '../components/Header.js'
import { showSkeleton } from '../components/Loading.js'
import { showModal } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { dateInputHTML, setupDateInput, getDateInputValue, setDateInputValue } from '../utils/dateInput.js'
import { escHtml } from '../utils/helpers.js'
let charts = {}
let lastBulkCharge = null
let dashNavigate = null

function destroyCharts() {
  Object.values(charts).forEach((c) => { try { c.destroy() } catch {} })
  charts = {}
}

export async function renderDashboard(container, navigate) {
  dashNavigate = navigate
  renderHeader('MunimJi', {
    rightAction: '<button class="btn-ghost btn-icon" id="refresh-dash"><ion-icon name="refresh-outline" class="text-xl"></ion-icon></button>'
  })

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div id="dash-summary" class="grid grid-cols-2 gap-3"></div>
      <div id="dash-party-outstanding" class="hidden card">
        <h3 class="font-semibold text-sm mb-3">Party-wise Outstanding</h3>
        <div id="dash-party-list"></div>
      </div>
      <div id="dash-pending-collections" class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Pending Interest Collections</h3>
          <button class="btn-ghost btn-icon text-primary" id="report-btn" title="Generate Report"><ion-icon name="document-text-outline" class="text-lg"></ion-icon></button>
        </div>
        <div id="dash-pending-list"></div>
      </div>
      <div id="dash-bulk-interest" class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Bulk Interest</h3>
          <ion-icon name="flash-outline" class="text-primary text-lg"></ion-icon>
        </div>
        <p class="text-[11px] text-gray-400 mb-3">Charge interest in bulk for multiple parties at once</p>
        <div id="bulk-charge-actions" class="space-y-2">
          <button class="btn-outline btn-sm w-full" id="bulk-interest-btn">
            <ion-icon name="flash-outline" class="text-sm mr-1"></ion-icon>
            Charge Interest
          </button>
          <button class="btn-outline btn-sm w-full text-red-500 border-red-200 hover:bg-red-50 hidden" id="bulk-undo-btn">
            <ion-icon name="arrow-undo-outline" class="text-sm mr-1"></ion-icon>
            Undo Last Charge
          </button>
        </div>
      </div>
      <div id="dash-chart-section" class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-sm">Monthly Overview</h3>
          <div class="flex gap-1">
            <button class="text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary font-medium chart-period active" data-period="month">Month</button>
            <button class="text-xs px-2 py-1 rounded-lg text-gray-500 font-medium chart-period" data-period="year">Year</button>
          </div>
        </div>
        <div class="chart-container" style="height:220px"><canvas id="dash-chart"></canvas></div>
      </div>
      <div id="dash-reports" class="card">
        <h3 class="font-semibold text-sm mb-3">Reports</h3>
        <div class="flex flex-wrap gap-2">
          <button class="btn-outline btn-sm" id="report-btn-interest"><ion-icon name="document-text-outline" class="text-sm mr-1"></ion-icon>Interest Collection Report</button>
          <button class="btn-outline btn-sm" id="report-btn-tax"><ion-icon name="calculator-outline" class="text-sm mr-1"></ion-icon>Tax Calculation Report</button>
          <button class="btn-outline btn-sm" id="report-btn-partner-transfer"><ion-icon name="git-network-outline" class="text-sm mr-1"></ion-icon>Partner Transfer Report</button>
        </div>
      </div>
      <div id="dash-recent" class="card">
        <h3 class="font-semibold text-sm mb-3">Recent Transactions</h3>
        <div id="dash-recent-list"></div>
      </div>
      <div id="dash-sources" class="card">
        <h3 class="font-semibold text-sm mb-3">Source Balances</h3>
        <div id="dash-sources-list"></div>
      </div>
    </div>
  `

  document.getElementById('refresh-dash')?.addEventListener('click', () => renderDashboard(container))

  const removeLoader = showSkeleton(document.getElementById('dash-summary'))
  const [sources, parties, allTxns, collaterals, allSrcTxns, allLedgers] = await Promise.all([
    getMoneySources(), getParties(), getAllTransactions(), getCollaterals(), getAllSourceTransactions(), getLedgers(),
  ])
  removeLoader()

  if (lastBulkCharge) {
    const stillExist = lastBulkCharge.ids.every(id => allTxns.some(t => t._id === id))
    if (!stillExist) lastBulkCharge = null
  }

  const activeParties = parties.filter((p) => p.status === 'active')
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  let totalLent = 0
  let totalOutstanding = 0
  for (const p of activeParties) {
    const partyTxns = allTxns.filter((t) => t.partyId === p._id)
    const outstanding = getOutstandingForParty(partyTxns)
    totalLent += partyTxns.filter((t) => t.type === 'debit' && t.category !== 'interest').reduce((s, t) => s + t.amount, 0)
    totalOutstanding += Math.max(0, outstanding)
  }

  const totalInterestIncome = allTxns
    .filter((t) => t.category === 'interest' && t.type === 'payment')
    .reduce((s, t) => s + t.amount, 0)

  const sourceBalances = {}
  for (const src of activeSources) {
    const srcTxns = allSrcTxns.filter((t) => t.sourceId === src._id)
    const principalTxns = allTxns.filter((t) => {
      if (!t.sourceAllocations || t.category === 'interest') return false
      return t.sourceAllocations.some((a) => a.sourceId === src._id)
    })
    const credits = srcTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
    const debits = srcTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
    const loansGiven = principalTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === src._id)?.amount || 0), 0)
    const repayments = principalTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === src._id)?.amount || 0), 0)
    sourceBalances[src._id] = (src.openingBalance || 0) + credits - debits - loansGiven + repayments
  }

  const totalSourceBalance = Object.values(sourceBalances).reduce((s, b) => s + b, 0)
  const totalSecurity = collaterals.filter((c) => c.status === 'held').reduce((s, c) => s + (c.estimatedValue || 0), 0)
  const overdueParties = activeParties.filter((p) => {
    const partyTxns = allTxns.filter((t) => t.partyId === p._id)
    if (partyTxns.length === 0) return false
    const lastTxn = partyTxns.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    return getOutstandingForParty(partyTxns) > 0 && (new Date() - new Date(lastTxn.date)) > 30 * 86400000
  })

  const pendingInterest = generateInterestReport(allTxns, activeParties, allLedgers)
  const pendingEl = document.getElementById('dash-pending-list')
  if (pendingInterest.length === 0) {
    document.getElementById('dash-pending-collections')?.classList.add('hidden')
  } else {
    pendingEl.innerHTML = pendingInterest.map((pc) => `
      <div class="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <div class="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <ion-icon name="trending-up-outline" class="text-sm"></ion-icon>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${pc.party.name}</div>
            <div class="text-[10px] text-gray-400 truncate">${pc.ledger.name} (${pc.ledger.interestRate}%/mo)</div>
          </div>
        </div>
        <div class="font-mono font-semibold text-sm text-amber-600 ml-3">${formatCurrencyFull(pc.netPending)}</div>
      </div>
    `).join('')
  }

  const summaryCards = [
    { label: 'Total Lent', value: formatCurrency(totalLent), color: 'text-vibgyor-indigo', icon: 'arrow-up-outline' },
    { label: 'Outstanding', value: formatCurrency(totalOutstanding), color: 'text-vibgyor-orange', icon: 'refresh-outline' },
    { label: 'Interest Earned', value: formatCurrency(totalInterestIncome), color: 'text-amber-600', icon: 'trending-up-outline' },
    { label: 'Source Balance', value: formatCurrency(totalSourceBalance), color: 'text-vibgyor-green', icon: 'wallet-outline' },
    { label: 'Security Held', value: formatCurrency(totalSecurity), color: 'text-vibgyor-violet', icon: 'shield-checkmark-outline' },
    { label: 'Active Loans', value: activeParties.length, color: 'text-vibgyor-blue', icon: 'people-outline' },
    { label: 'Overdue', value: overdueParties.length, color: 'text-vibgyor-red', icon: 'alert-circle-outline' },
  ]

  document.getElementById('dash-summary').innerHTML = summaryCards.map((c) => `
    <div class="card-flat flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center ${c.color}">
        <ion-icon name="${c.icon}" class="text-lg"></ion-icon>
      </div>
      <div>
        <div class="stat-value ${c.color}">${c.value}</div>
        <div class="stat-label">${c.label}</div>
      </div>
    </div>
  `).join('')

  const partyOutstanding = activeParties.map(p => ({
    _id: p._id,
    name: p.name,
    amount: Math.round(Math.max(0, getOutstandingForParty(allTxns.filter(t => t.partyId === p._id))) * 100) / 100,
  })).filter(p => p.amount > 0).sort((a, b) => b.amount - a.amount)
  const partyOsEl = document.getElementById('dash-party-outstanding')
  if (partyOutstanding.length > 0) {
    const partyListEl = document.getElementById('dash-party-list')
    partyListEl.innerHTML = partyOutstanding.map(p => `
      <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50" data-party-id="${escHtml(p._id)}">
        <span class="text-sm">${escHtml(p.name)}</span>
        <span class="amount-negative text-sm">${formatCurrencyFull(p.amount)}</span>
      </div>
    `).join('')
    partyListEl.onclick = (e) => {
      const row = e.target.closest('[data-party-id]')
      if (row) dashNavigate('party-detail', { id: row.dataset.partyId })
    }
    partyOsEl?.classList.remove('hidden')
  }

  const recentTxns = allTxns.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10)
  const partyMap = {}
  parties.forEach((p) => { partyMap[p._id] = p })

  const recentEl = document.getElementById('dash-recent-list')
  if (recentTxns.length === 0) {
    recentEl.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">No transactions yet</div>'
  } else {
    recentEl.innerHTML = recentTxns.map((t) => `
      <div class="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${partyMap[t.partyId]?.name || 'Unknown'}</div>
          <div class="text-xs text-gray-400">${formatDateShort(t.date)}</div>
        </div>
        <div class="text-right">
          <div class="${t.type === 'debit' ? 'amount-negative' : 'amount-positive'}">${formatCurrencyFull(t.amount)}</div>
          <div class="text-xs ${t.type === 'debit' ? 'text-red-500' : 'text-green-500'}">${t.type === 'debit' ? 'Given' : 'Returned'}</div>
        </div>
      </div>
    `).join('')
  }

  const sourcesEl = document.getElementById('dash-sources-list')
  if (activeSources.length === 0) {
    sourcesEl.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">No sources added yet</div>'
  } else {
    sourcesEl.innerHTML = activeSources.map((s) => `
      <div class="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div class="flex items-center gap-2">
          <ion-icon name="${s.type === 'cash' ? 'cash-outline' : s.type === 'bank' ? 'business-outline' : s.type === 'partner' ? 'people-outline' : 'ellipsis-horizontal-outline'}" class="text-gray-400 text-lg"></ion-icon>
          <div>
            <div class="text-sm font-medium">${s.name}</div>
            <div class="text-xs text-gray-400 capitalize">${s.type}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="font-mono font-semibold text-sm">${formatCurrencyFull(sourceBalances[s._id] ?? 0)}</div>
        </div>
      </div>
    `).join('')
  }

  setupChart(allTxns, parties)

  document.getElementById('bulk-interest-btn')?.addEventListener('click', async () => {
    const today = new Date().toISOString().split('T')[0]

    const partyCheckboxes = activeParties.map(p => `
      <label class="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
        <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary bulk-party-cb" value="${p._id}" checked />
        <span class="text-sm">${escHtml(p.name)}</span>
      </label>
    `).join('')

    const content = `
      <div class="space-y-3">
        <div>
          <label class="input-label">Charge Date</label>
          ${dateInputHTML({id: 'bulk-date', value: today, cls: 'flex-1'})}
        </div>
        <div>
          <label class="input-label">Select Parties</label>
          <div class="max-h-40 overflow-y-auto border border-gray-200 rounded-xl px-3 py-1">${partyCheckboxes}</div>
        </div>
      </div>
    `

    const result = await showModal({
      title: 'Bulk Interest Charge',
      content,
      confirmText: 'Charge',
      onMounted: () => { setupDateInput('bulk-date') },
      onConfirm: () => {
        const toDate = getDateInputValue('bulk-date')
        if (!toDate) { showToast('Select a date', 'error'); return false }
        const partyIds = Array.from(document.querySelectorAll('.bulk-party-cb:checked')).map(cb => cb.value)
        if (partyIds.length === 0) { showToast('Select at least one party', 'error'); return false }
        return { toDate, partyIds }
      },
    })

    if (!result || result === true) return
    const { toDate, partyIds } = result

    let charged = 0, totalAmount = 0, errorCount = 0
    const chargedIds = []
    const chargedParties = []
    showToast('Charging interest...', 'info')

    for (const pid of partyIds) {
      const party = parties.find(p => p._id === pid)
      if (!party) continue
      const partyLedgers = allLedgers.filter(l => l.partyId === pid && l.status !== 'closed' && l.interestRate)
      if (partyLedgers.length === 0) continue

      for (const ledger of partyLedgers) {
        const ledgerTxns = allTxns.filter(t => t.partyId === pid && t.ledgerId === ledger._id)
        if (ledgerTxns.filter(t => !t.category || t.category === 'principal').length === 0) continue

        const lastChargeDate = getLastInterestChargeDate(ledgerTxns)
        let fromDate
        if (lastChargeDate) {
          const d = new Date(lastChargeDate + 'T00:00:00')
          d.setDate(d.getDate() + 1)
          fromDate = d.toISOString().split('T')[0]
        } else {
          const firstDate = getFirstPrincipalDate(ledgerTxns)
          if (!firstDate || firstDate >= toDate) continue
          fromDate = firstDate
        }

        if (fromDate >= toDate) continue

        const charges = calculateMonthlyCharges({ transactions: ledgerTxns, rate: ledger.interestRate, fromDate, toDate })
        if (charges.length === 0) continue

        const totalInterest = charges.reduce((s, c) => s + c.amount, 0)
        if (Math.round(Math.abs(totalInterest) * 100) / 100 < 0.01) continue

        try {
          const data = {
            partyId: pid,
            ledgerId: ledger._id,
            category: 'interest',
            type: 'charge',
            amount: Math.round(totalInterest * 100) / 100,
            date: toDate,
            notes: `Interest charged from ${formatDate(charges[0].fromDate)} to ${formatDate(toDate)}`,
            breakdown: charges,
            updatedAt: new Date().toISOString(),
          }
          const saved = await saveTransaction(data)
          chargedIds.push(saved.id)
          chargedParties.push({ party: party.name, ledger: ledger.name, amount: Math.round(totalInterest * 100) / 100 })
          charged++
          totalAmount += totalInterest
        } catch (e) {
          console.error('Bulk interest charge error:', e)
          errorCount++
        }
      }
    }

    if (charged === 0) {
      showToast('No interest to charge for selected parties', 'error')
    } else {
      const partySummary = {}
      chargedParties.forEach(p => {
        partySummary[p.party] = (partySummary[p.party] || 0) + p.amount
      })
      const summaryParts = Object.entries(partySummary).map(([name, amt]) => `${name}: ₹${Math.round(amt * 100) / 100}`)
      logAction('charge', 'interest', chargedIds.join(','), `Bulk interest charged till ${toDate} — Total: ₹${Math.round(totalAmount * 100) / 100}. ${summaryParts.join('; ')}`)
      lastBulkCharge = { ids: chargedIds, parties: chargedParties, count: charged, total: totalAmount, date: toDate }
      showToast(`Interest charged: ₹${Math.round(totalAmount * 100) / 100} across ${charged} ledger(s)${errorCount ? `, ${errorCount} error(s)` : ''}`, 'success')
      await renderDashboard(container)
      const undoBtn = document.getElementById('bulk-undo-btn')
      if (undoBtn) { undoBtn.classList.remove('hidden'); document.getElementById('bulk-interest-btn')?.classList.add('hidden') }
    }
  })

  document.getElementById('bulk-undo-btn')?.addEventListener('click', async () => {
    if (!lastBulkCharge || lastBulkCharge.ids.length === 0) return
    const ids = [...lastBulkCharge.ids]
    const info = lastBulkCharge
    let deleted = 0, errs = 0
    for (const id of ids) {
      try {
        await deleteTransaction(id)
        deleted++
      } catch { errs++ }
    }
    logAction('undo', 'interest', ids.join(','), `Undid bulk interest charge of ₹${Math.round(info.total * 100) / 100} (${info.count} ledger(s), ${info.date})`)
    lastBulkCharge = null
    document.getElementById('bulk-undo-btn')?.classList.add('hidden')
    document.getElementById('bulk-interest-btn')?.classList.remove('hidden')
    showToast(`Undone: ${deleted} charge(s) deleted${errs ? `, ${errs} error(s)` : ''}`, 'info')
    renderDashboard(container)
  })

  if (lastBulkCharge) {
    document.getElementById('bulk-undo-btn')?.classList.remove('hidden')
    document.getElementById('bulk-interest-btn')?.classList.add('hidden')
  }

  document.querySelectorAll('.chart-period').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-period').forEach((b) => {
        b.classList.remove('active', 'bg-primary/10', 'text-primary')
        b.classList.add('text-gray-500')
      })
      btn.classList.add('active', 'bg-primary/10', 'text-primary')
      btn.classList.remove('text-gray-500')
      setupChart(allTxns, parties)
    })
  })

  document.getElementById('report-btn')?.addEventListener('click', () => {
    const data = generateInterestReport(allTxns, activeParties, allLedgers)
    renderReportOverlay(data)
  })
  document.getElementById('report-btn-interest')?.addEventListener('click', () => {
    const data = generateInterestReport(allTxns, activeParties, allLedgers)
    renderReportOverlay(data)
  })
  document.getElementById('report-btn-tax')?.addEventListener('click', async () => {
    const fy = getFinancialYearRange()
    const today = new Date().toISOString().split('T')[0]
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const partyCheckboxes = parties.map(p => `
      <label class="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
        <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary tax-party-cb" value="${p._id}" checked />
        <span class="text-sm">${escHtml(p.name)}</span>
        <span class="text-[10px] text-gray-400 ml-auto ${p.status !== 'active' ? 'text-amber-500' : ''}">${p.status !== 'active' ? p.status : ''}</span>
      </label>
    `).join('')

    const content = `
      <div class="space-y-3">
        <div>
          <label class="input-label">Select Parties</label>
          <div class="flex gap-3 mb-1.5">
            <button class="text-xs text-primary font-medium" id="tax-select-all">Select All</button>
            <button class="text-xs text-gray-400 font-medium" id="tax-deselect-all">Deselect All</button>
          </div>
          <div class="max-h-40 overflow-y-auto border border-gray-200 rounded-xl px-3 py-1">${partyCheckboxes}</div>
        </div>
        <div>
          <label class="input-label">Date Range</label>
          <div class="flex items-center gap-2">
            ${dateInputHTML({id: 'tax-from', value: sixMonthsAgo.toISOString().split('T')[0], cls: 'flex-1'})}
            <span class="text-xs text-gray-400">to</span>
            ${dateInputHTML({id: 'tax-to', value: today, cls: 'flex-1'})}
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 tax-quick-range" data-from="${fy.from}" data-to="${fy.to}">FY ${fy.label}</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 tax-quick-range" data-from="${sixMonthsAgo.toISOString().split('T')[0]}" data-to="${today}">Last 6 months</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 tax-quick-range" data-from="${new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0]}" data-to="${today}">Last 3 months</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 tax-quick-range" data-from="${new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0]}" data-to="${today}">Last 1 year</button>
        </div>
      </div>
    `

    const result = await showModal({
      title: 'Tax Calculation Report',
      content,
      confirmText: 'Generate',
      onMounted: () => {
        setupDateInput('tax-from')
        setupDateInput('tax-to')
        document.querySelectorAll('.tax-quick-range').forEach(btn => {
          btn.addEventListener('click', () => {
            setDateInputValue('tax-from', btn.dataset.from)
            setDateInputValue('tax-to', btn.dataset.to)
          })
        })
        document.getElementById('tax-select-all')?.addEventListener('click', () => {
          document.querySelectorAll('.tax-party-cb').forEach(cb => cb.checked = true)
        })
        document.getElementById('tax-deselect-all')?.addEventListener('click', () => {
          document.querySelectorAll('.tax-party-cb').forEach(cb => cb.checked = false)
        })
      },
      onConfirm: () => {
        const partyIds = Array.from(document.querySelectorAll('.tax-party-cb:checked')).map(cb => cb.value)
        if (partyIds.length === 0) { showToast('Select at least one party', 'error'); return false }
        const fromDate = getDateInputValue('tax-from')
        const toDate = getDateInputValue('tax-to')
        if (!fromDate || !toDate) { showToast('Select date range', 'error'); return false }
        return { partyIds, fromDate, toDate }
      },
    })

    if (!result || result === true) return
    const data = generateTaxReport({
      partyIds: result.partyIds,
      fromDate: result.fromDate,
      toDate: result.toDate,
      allTxns,
      allSources: sources,
      allParties: parties,
      allLedgers,
    })
    if (data.rows.length === 0) { showToast('No data for selected criteria', 'error'); return }
    renderTaxReportOverlay(data)
  })

  document.getElementById('report-btn-partner-transfer')?.addEventListener('click', async () => {
    const today = new Date().toISOString().split('T')[0]
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const fy = getFinancialYearRange()

    const content = `
      <div class="space-y-3">
        <div>
          <label class="input-label">Date Range</label>
          <div class="flex items-center gap-2">
            ${dateInputHTML({id: 'ptr-from', value: sixMonthsAgo.toISOString().split('T')[0], cls: 'flex-1'})}
            <span class="text-xs text-gray-400">to</span>
            ${dateInputHTML({id: 'ptr-to', value: today, cls: 'flex-1'})}
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 ptr-quick-range" data-from="${fy.from}" data-to="${fy.to}">FY ${fy.label}</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 ptr-quick-range" data-from="${sixMonthsAgo.toISOString().split('T')[0]}" data-to="${today}">Last 6 months</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 ptr-quick-range" data-from="${new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().split('T')[0]}" data-to="${today}">Last 3 months</button>
          <button class="text-xs py-1 px-2.5 rounded-full border border-gray-200 ptr-quick-range" data-from="" data-to="">All Time</button>
        </div>
      </div>
    `

    const result = await showModal({
      title: 'Partner Transfer Report',
      content,
      confirmText: 'Generate',
      onMounted: () => {
        setupDateInput('ptr-from')
        setupDateInput('ptr-to')
        document.querySelectorAll('.ptr-quick-range').forEach(btn => {
          btn.addEventListener('click', () => {
            setDateInputValue('ptr-from', btn.dataset.from)
            setDateInputValue('ptr-to', btn.dataset.to)
          })
        })
      },
      onConfirm: () => {
        const fromDate = getDateInputValue('ptr-from')
        const toDate = getDateInputValue('ptr-to')
        if (!fromDate || !toDate) { showToast('Select date range', 'error'); return false }
        return { fromDate, toDate }
      },
    })

    if (!result || result === true) return
    const data = generatePartnerTransferReport({
      fromDate: result.fromDate,
      toDate: result.toDate,
      allSourceTxns: allSrcTxns,
      allSources: sources,
    })
    renderPartnerTransferReportOverlay(data)
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

function setupChart(allTxns, parties) {
  const canvas = document.getElementById('dash-chart')
  if (!canvas) return
  destroyCharts()

  const period = document.querySelector('.chart-period.active')?.dataset.period || 'month'
  const now = new Date()

  const principalTxns = allTxns.filter((t) => !t.category || t.category === 'principal')

  let labels, debitData, creditData
  if (period === 'month') {
    const days = []
    const debits = []
    const credits = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      days.push(d.getDate() + '/' + (d.getMonth() + 1))
      debits.push(principalTxns.filter((t) => t.type === 'debit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
      credits.push(principalTxns.filter((t) => t.type === 'credit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
    }
    labels = days; debitData = debits; creditData = credits
  } else {
    const years = []
    const debits = []
    const credits = []
    const currentYear = now.getFullYear()
    for (let i = 4; i >= 0; i--) {
      const year = currentYear - i
      const key = String(year)
      years.push(key)
      debits.push(principalTxns.filter((t) => t.type === 'debit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
      credits.push(principalTxns.filter((t) => t.type === 'credit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
    }
    labels = years; debitData = debits; creditData = credits
  }

  charts.main = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Given', data: debitData, backgroundColor: '#EF4444', borderRadius: 4, barPercentage: 0.4 },
        { label: 'Returned', data: creditData, backgroundColor: '#10B981', borderRadius: 4, barPercentage: 0.4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: (v) => v >= 100000 ? (v / 100000).toFixed(0) + 'L' : v } },
      },
    },
  })
}
