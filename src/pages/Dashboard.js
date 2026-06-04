import { getMoneySources, getParties, getAllTransactions, getCollaterals } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDateShort } from '../utils/formatters.js'
import { getOutstandingForParty } from '../services/interest.js'
import { renderHeader } from '../components/Header.js'
import { showSkeleton } from '../components/Loading.js'
import { financeIllustration, decorativeBg } from '../assets/vectors.js'

let charts = {}

function destroyCharts() {
  Object.values(charts).forEach((c) => { try { c.destroy() } catch {} })
  charts = {}
}

export async function renderDashboard(container) {
  renderHeader('Lending Accountant', {
    rightAction: '<button class="btn-ghost btn-icon" id="refresh-dash"><ion-icon name="refresh-outline" class="text-xl"></ion-icon></button>'
  })

  container.innerHTML = `
    <div class="space-y-4 slide-up relative">
      ${decorativeBg()}
      <div class="relative">
        <div class="flex items-center justify-center mb-1">${financeIllustration()}</div>
        <div id="dash-summary" class="grid grid-cols-2 gap-3"></div>
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
  const [sources, parties, allTxns, collaterals] = await Promise.all([
    getMoneySources(), getParties(), getAllTransactions(), getCollaterals(),
  ])
  removeLoader()

  const activeParties = parties.filter((p) => p.status === 'active')
  const activeSources = sources.filter((s) => s.status !== 'inactive')

  let totalLent = 0
  let totalOutstanding = 0
  let totalInterest = 0
  for (const p of activeParties) {
    const partyTxns = allTxns.filter((t) => t.partyId === p._id)
    const outstanding = getOutstandingForParty(partyTxns)
    totalLent += partyTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
    totalOutstanding += Math.max(0, outstanding)
  }

  const totalSourceBalance = activeSources.reduce((s, src) => s + (src.currentBalance || src.openingBalance || 0), 0)
  const totalSecurity = collaterals.filter((c) => c.status === 'held').reduce((s, c) => s + (c.estimatedValue || 0), 0)
  const overdueParties = activeParties.filter((p) => {
    const partyTxns = allTxns.filter((t) => t.partyId === p._id)
    if (partyTxns.length === 0) return false
    const lastTxn = partyTxns.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    return getOutstandingForParty(partyTxns) > 0 && (new Date() - new Date(lastTxn.date)) > 30 * 86400000
  })

  const summaryCards = [
    { label: 'Total Lent', value: formatCurrency(totalLent), color: 'text-vibgyor-indigo', icon: 'arrow-up-outline' },
    { label: 'Outstanding', value: formatCurrency(totalOutstanding), color: 'text-vibgyor-orange', icon: 'refresh-outline' },
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
          <div class="font-mono font-semibold text-sm">${formatCurrencyFull(s.currentBalance || s.openingBalance || 0)}</div>
        </div>
      </div>
    `).join('')
  }

  setupChart(allTxns, parties)
  document.querySelectorAll('.chart-period').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-period').forEach((b) => b.classList.remove('bg-primary/10', 'text-primary'))
      btn.classList.add('bg-primary/10', 'text-primary')
      setupChart(allTxns, parties)
    })
  })
}

function setupChart(allTxns, parties) {
  const canvas = document.getElementById('dash-chart')
  if (!canvas) return
  destroyCharts()

  const period = document.querySelector('.chart-period.active')?.dataset.period || 'month'
  const now = new Date()

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
      debits.push(allTxns.filter((t) => t.type === 'debit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
      credits.push(allTxns.filter((t) => t.type === 'credit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
    }
    labels = days; debitData = debits; creditData = credits
  } else {
    const months = []
    const debits = []
    const credits = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = d.toISOString().slice(0, 7)
      months.push(d.toLocaleDateString('en-IN', { month: 'short' }))
      debits.push(allTxns.filter((t) => t.type === 'debit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
      credits.push(allTxns.filter((t) => t.type === 'credit' && t.date.startsWith(key)).reduce((s, t) => s + t.amount, 0))
    }
    labels = months; debitData = debits; creditData = credits
  }

  charts.main = new Chart(canvas, {
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
