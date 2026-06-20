import { getMoneySources, getAllStockSymbols, saveStockSymbol, getStockEntries, getStockEntry, saveStockEntry, deleteStockEntry, deleteStockSymbol, getAllStockEntries } from '../db/database.js'
import { getSettings, saveSettings } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDate } from '../utils/formatters.js'
import { dateInputHTML, setupDateInput, getDateInputValue, setDateInputValue } from '../utils/dateInput.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showPrompt, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { fetchPrices, getCachedPrice, isStale, getLastSourceInfo } from '../services/stockPrice.js'
import { calcDaysHeld, calcCurrentValue, calcV1, calcV2, calcAvgBuyPrice, calcAvgDays, calcTotalQty, calcAggregatedCurrentValue, sellLIFO } from '../services/stockCalc.js'
import { calc1234Lots, computeExistingHoldings, getStrategies, getStrategy, saveStrategy, deleteStrategy, computeStockSoldMetrics } from '../services/stockStrategy.js'
import { escHtml } from '../utils/helpers.js'

let allPartners = []
let allStocks = []
let selectedPartners = new Set()

export async function renderStock(container, navigate) {
  const settings = await getSettings()
  const savedPartners = settings.stockPartners || []

  renderHeader('Stock Management', {
    rightAction: `<button class="btn-icon btn-ghost" id="stock-menu-btn"><ion-icon name="ellipsis-vertical-outline" class="text-xl"></ion-icon></button>`
  })

  container.innerHTML = `
    <div class="slide-up">
      <div id="stock-summary" class="card-flat mb-3 hidden"></div>
      <div id="stock-pareto" class="mb-3"></div>
      <div id="stock-trade-viewer" class="mb-3"></div>
      <div id="stock-analysis" class="mb-3"></div>
      <div id="stock-list" class="space-y-2"></div>
    </div>
  `

  const removeLoader = showSkeleton(container.querySelector('#stock-list'))
  const [sources, stocks] = await Promise.all([getMoneySources(), getAllStockSymbols()])
  const partnerMap = new Map()
  for (const s of sources) {
    if (s.owner && !partnerMap.has(s.owner)) {
      partnerMap.set(s.owner, s._id)
    }
  }
  allPartners = Array.from(partnerMap).map(([name, id]) => ({ name, sourceId: id }))

  if (savedPartners.length > 0) {
    selectedPartners = new Set(savedPartners)
  } else {
    selectedPartners = new Set(allPartners.map(p => p.name))
    await saveSettings({ ...(await getSettings()), stockPartners: [...selectedPartners] })
  }

  allStocks = stocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  removeLoader()

  renderStockList()

  document.getElementById('stock-menu-btn').addEventListener('click', () => showStockMenu())

  renderTradeViewerTrigger()
  renderAnalysisSection()

  const fab = document.createElement('div')
  fab.id = 'app-fab'
  fab.className = 'fixed bottom-20 right-4 z-10'
  fab.innerHTML = `<button class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-vibgyor-violet text-white shadow-lg flex items-center justify-center text-2xl hover:scale-105 active:scale-95 transition-transform" id="stock-fab"><ion-icon name="add-outline"></ion-icon></button>`
  document.body.appendChild(fab)

  document.getElementById('stock-fab').addEventListener('click', () => showAddStockForm())
}

async function renderStockList() {
  const entriesByStock = {}
  for (const s of allStocks) {
    entriesByStock[s._id] = []
  }

  const el = document.getElementById('stock-list')
  if (allStocks.length === 0) {
    el.innerHTML = '<div class="empty-state"><ion-icon name="trending-up-outline" class="text-3xl text-gray-300"></ion-icon><p class="text-sm text-gray-400">No stocks yet. Tap + to add one.</p></div>'
    return
  }

  const allEntries = await Promise.all(allStocks.map(s => getStockEntries(s._id)))
  for (let i = 0; i < allStocks.length; i++) {
    entriesByStock[allStocks[i]._id] = allEntries[i]
  }

  let totalInvested = 0
  let totalDays = 0
  let totalQtyAll = 0
  let realizedPnL = 0
  let unrealizedPnL = 0
  let totalMarketValue = 0
  let liveCount = 0
  const partnerPnL = {}

  for (const s of allStocks) {
    const entries = entriesByStock[s._id] || []
    const activeEntries = entries.filter(e => e.remainingQty > 0)
    const totalQty = calcTotalQty(activeEntries)
    const avgPrice = calcAvgBuyPrice(activeEntries)
    const avgDays = calcAvgDays(activeEntries)

    if (totalQty > 0) {
      totalInvested += totalQty * avgPrice
      totalDays += totalQty * avgDays
      totalQtyAll += totalQty
      const ltp = getCachedPrice(s.symbol)
      if (ltp != null) {
        totalMarketValue += totalQty * ltp
        liveCount++
      }
    }

    for (const e of entries) {
      const partner = e.partnerName || 'Unknown'
      if (!partnerPnL[partner]) partnerPnL[partner] = { realized: 0, unrealized: 0, symbol: s.symbol }
      if (e.remainingQty > 0) {
        const days = calcDaysHeld(e.date)
        const cv = calcCurrentValue(e.price, e.monthlyRate, e.minReturn, days)
        const upnl = (cv - e.price) * e.remainingQty
        unrealizedPnL += upnl
        partnerPnL[partner].unrealized += upnl
      } else if (e.soldPrice) {
        const rpnl = (e.soldPrice - e.price) * e.qty
        realizedPnL += rpnl
        partnerPnL[partner].realized += rpnl
      }
    }
  }

  const totalPnL = totalMarketValue > 0 ? totalMarketValue - totalInvested : 0
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested * 100) : 0

  function stockCardHtml(s) {
    const entries = entriesByStock[s._id] || []
    const activeEntries = entries.filter(e => e.remainingQty > 0)
    const totalQty = calcTotalQty(activeEntries)
    const avgPrice = calcAvgBuyPrice(activeEntries)
    const avgDays = calcAvgDays(activeEntries)
    const avgValue = calcAggregatedCurrentValue(activeEntries)
    const ltp = getCachedPrice(s.symbol)
    const pnlPct = ltp != null && avgValue > 0 ? ((ltp - avgValue) / avgValue * 100) : null
    return `
      <div class="card stock-card !p-3 ${s.status === 'inactive' ? 'bg-gray-100' : ''}" data-id="${s._id}">
        <div class="flex items-center justify-between mb-1">
          <span class="font-bold text-sm">${escHtml(s.symbol)} <span class="text-[11px] font-normal text-gray-400">(Q: ${totalQty} | D: ${avgDays > 0 ? Math.round(avgDays) : '-'})</span></span>
          <div class="flex items-center gap-1.5">
            ${totalQty > 0 ? `
              <button class="w-7 h-7 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center stock-buy shadow-sm" data-id="${s._id}">B</button>
              <button class="w-7 h-7 rounded-lg bg-red-500 text-white text-xs font-bold flex items-center justify-center stock-sell shadow-sm" data-id="${s._id}">S</button>
            ` : `
              <button class="w-7 h-7 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center stock-buy shadow-sm" data-id="${s._id}">B</button>
            `}
          </div>
        </div>
        <div class="flex items-center justify-between text-[11px] ${totalQty === 0 ? 'text-gray-400' : ''}">
          <div class="flex items-center gap-2">
            <span><span class="text-gray-400">P</span> <span class="font-semibold">${avgPrice > 0 ? formatCurrencyFull(avgPrice) : '-'}</span></span>
            <span class="text-gray-200">|</span>
            <span><span class="text-gray-400">V</span> <span class="font-semibold">${avgValue > 0 ? formatCurrencyFull(avgValue) : '-'}</span></span>
            <span class="text-gray-200">|</span>
            <span><span class="text-gray-400">LTP</span> <span class="font-semibold">${ltp != null ? formatCurrencyFull(ltp) : '-'}</span></span>
            <span class="text-gray-200">|</span>
            <span><span class="text-gray-400">P&amp;L</span> <span class="font-semibold font-mono ${pnlPct != null ? (pnlPct >= 0 ? 'text-green-600' : 'text-red-600') : ''}">${pnlPct != null ? (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : '-'}</span></span>
          </div>
          <div class="strategy-info flex items-center gap-1 text-[10px]" data-id="${s._id}">
            <span class="text-gray-400">NA</span>
            <button class="strategy-add text-amber-500 font-bold text-xs leading-none hover:text-amber-700" data-id="${s._id}" title="Create Strategy">+</button>
          </div>
        </div>
      </div>
    `
  }

  const activeStocks = allStocks.filter(s => s.status !== 'inactive')
  const inactiveStocks = allStocks.filter(s => s.status === 'inactive')

  let listHtml = ''
  if (activeStocks.length > 0) {
    listHtml += `<div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-0.5">Active — ${activeStocks.length}</div>`
    listHtml += activeStocks.map(stockCardHtml).join('')
  }
  if (inactiveStocks.length > 0) {
    listHtml += `<div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-3 mb-1.5 px-0.5">Inactive — ${inactiveStocks.length}</div>`
    listHtml += inactiveStocks.map(stockCardHtml).join('')
  }
  el.innerHTML = listHtml

    const summaryEl = document.getElementById('stock-summary')
    if (totalQtyAll > 0 || realizedPnL !== 0) {
      summaryEl.classList.remove('hidden')
      const partnerRows = Object.entries(partnerPnL).sort(([a], [b]) => a.localeCompare(b)).map(([name, p]) => {
        return `<div class="flex items-center justify-between text-[11px] py-1 border-b border-gray-50 last:border-0">
          <span class="text-gray-600">${escHtml(name)}</span>
          <span class="font-mono font-semibold ${p.realized >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(p.realized)}</span>
        </div>`
      }).join('')
      summaryEl.innerHTML = `
        <div class="grid grid-cols-2 gap-2 text-center mb-2">
          <div>
            <div class="stat-label">Total Investment</div>
            <div class="stat-value text-sm">${formatCurrency(totalInvested)}</div>
          </div>
          <div>
            <div class="stat-label">Avg Hold Days</div>
            <div class="stat-value text-sm">${totalQtyAll > 0 ? Math.round(totalDays / totalQtyAll) + 'd' : '-'}</div>
          </div>
          <div>
            <div class="stat-label">Market Value</div>
            <div class="stat-value text-sm flex items-center justify-center gap-1">
              <span>${liveCount > 0 ? formatCurrencyFull(totalMarketValue) : 'NA'}</span>
              <button class="stock-refresh-prices inline-flex items-center justify-center text-xs px-1.5 py-0.5 rounded-full ${liveCount > 0 ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-primary text-white'}" title="${liveCount > 0 ? 'Refresh live prices' : 'Pull live prices'}">
                <ion-icon name="${liveCount > 0 ? 'refresh-outline' : 'download-outline'}" class="text-sm"></ion-icon>
              </button>
            </div>
          </div>
          <div>
            <div class="stat-label">P&amp;L</div>
            <div class="stat-value text-sm font-mono ${liveCount > 0 ? (totalPnL >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}">${liveCount > 0 ? `${formatCurrencyFull(totalPnL)} (${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%)` : 'NA'}</div>
          </div>
          ${realizedPnL !== 0 || unrealizedPnL !== 0 ? `
          <div>
            <div class="stat-label">Realized P&amp;L</div>
            <div class="stat-value text-sm font-mono ${realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(realizedPnL)}</div>
          </div>
          <div>
            <div class="stat-label">Unrealized P&amp;L</div>
            <div class="stat-value text-sm font-mono ${unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(unrealizedPnL)}</div>
          </div>
          ` : ''}
        </div>
        ${Object.keys(partnerPnL).length > 0 ? `
        <div class="border-t border-gray-200 pt-2">
          <div class="text-[10px] text-gray-400 font-medium mb-1">Partner-wise P&amp;L</div>
          ${partnerRows}
        </div>` : ''}
      `
    } else {
      summaryEl.classList.add('hidden')
    }

    el.querySelectorAll('.stock-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.stock-buy') || e.target.closest('.stock-sell') || e.target.closest('.strategy-link') || e.target.closest('.strategy-add')) return
        showStockDetail(card.dataset.id)
      })
    })
    el.querySelectorAll('.stock-buy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        showBuyForm(btn.dataset.id)
      })
    })
    el.querySelectorAll('.stock-sell').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        showSellForm(btn.dataset.id)
      })
    })

    getStrategies().then(strats => {
      for (const s of strats) {
        const info = el.querySelector(`.strategy-info[data-id="${s.stockId}"]`)
        if (!info) continue
        const label = escHtml(s.label || 'Strategy')
        info.innerHTML = `
          <span class="strategy-link text-amber-600 cursor-pointer hover:underline" data-strategy="${s._id}">${label}</span>
          <button class="strategy-add text-amber-500 font-bold text-xs leading-none hover:text-amber-700" data-id="${s.stockId}" title="Manage Strategy">+</button>
        `
      }
      el.querySelectorAll('.strategy-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.stopPropagation()
          showStrategyDetail(link.dataset.strategy)
        })
      })
      el.querySelectorAll('.strategy-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          showStrategyForStock(btn.dataset.id)
        })
      })
    })

  const refreshBtn = summaryEl ? summaryEl.querySelector('.stock-refresh-prices') : null
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      refreshBtn.disabled = true
      refreshBtn.innerHTML = '<ion-icon name="sync-outline" class="text-sm animate-spin"></ion-icon>'
      const symbols = [...new Set(allStocks.flatMap(s => {
        const entries = entriesByStock[s._id] || []
        return entries.some(e => e.remainingQty > 0) ? [s.symbol] : []
      }))]
      if (symbols.length > 0) await fetchPrices(symbols)
      renderStockList()
    })
  }

  renderParetoAnalysis(entriesByStock)
}

async function showStockMenu() {
  const choice = await showModal({
    title: 'Stock Settings',
    content: `
      <div class="space-y-2">
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 cursor-pointer">
          <input type="radio" name="stock-action" value="manage" class="text-primary focus:ring-primary" checked />
          <span class="text-sm font-medium flex items-center gap-2"><ion-icon name="people-outline" class="text-primary text-lg"></ion-icon> Manage Partners</span>
        </label>
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 cursor-pointer">
          <input type="radio" name="stock-action" value="add" class="text-primary focus:ring-primary" />
          <span class="text-sm font-medium flex items-center gap-2"><ion-icon name="person-add-outline" class="text-primary text-lg"></ion-icon> Add Partner</span>
        </label>
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 cursor-pointer">
          <input type="radio" name="stock-action" value="trade-report" class="text-primary focus:ring-primary" />
          <span class="text-sm font-medium flex items-center gap-2"><ion-icon name="document-text-outline" class="text-primary text-lg"></ion-icon> Trade Report</span>
        </label>
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 cursor-pointer">
          <input type="radio" name="stock-action" value="export" class="text-primary focus:ring-primary" />
          <span class="text-sm font-medium flex items-center gap-2"><ion-icon name="download-outline" class="text-primary text-lg"></ion-icon> Export CSV</span>
        </label>
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 cursor-pointer">
          <input type="radio" name="stock-action" value="import" class="text-primary focus:ring-primary" />
          <span class="text-sm font-medium flex items-center gap-2"><ion-icon name="cloud-upload-outline" class="text-primary text-lg"></ion-icon> Import CSV</span>
        </label>
        <div class="border-t border-gray-200 my-1"></div>
        <label class="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 cursor-pointer">
          <input type="radio" name="stock-action" value="delete-all" class="text-red-500 focus:ring-red-500" />
          <span class="text-sm font-medium flex items-center gap-2 text-red-600"><ion-icon name="trash-outline" class="text-red-500 text-lg"></ion-icon> Delete All Stock Data</span>
        </label>
      </div>
    `,
    confirmText: 'Go',
    onConfirm: () => {
      const sel = document.querySelector('input[name="stock-action"]:checked')
      return sel?.value || null
    },
  })

  if (choice === 'manage') await showPartnerManager()
  else if (choice === 'add') await addPartner()
  else if (choice === 'trade-report') await showTradeReport()
  else if (choice === 'export') await exportStockCSV()
  else if (choice === 'import') await importStockCSV()
  else if (choice === 'delete-all') await deleteAllStockData()
}

async function showPartnerManager() {
  const allKnown = new Map()
  for (const p of allPartners) allKnown.set(p.name, true)
  for (const name of selectedPartners) allKnown.set(name, true)
  const allNames = Array.from(allKnown.keys()).sort()

  const checkboxes = allNames.map(name => `
    <label class="flex items-center gap-2.5 py-2 px-1 cursor-pointer">
      <input type="checkbox" class="rounded border-gray-300 text-primary focus:ring-primary partner-cb" value="${escHtml(name)}" ${selectedPartners.has(name) ? 'checked' : ''} />
      <span class="text-sm">${escHtml(name)}</span>
    </label>
  `).join('')

  const content = `
    <div class="space-y-1 max-h-64 overflow-y-auto">${checkboxes}</div>
  `

  await showModal({
    title: 'Manage Partners',
    content,
    confirmText: 'Save',
    onConfirm: async () => {
      const checked = document.querySelectorAll('.partner-cb:checked')
      selectedPartners = new Set(Array.from(checked).map(cb => cb.value))
      const settings = await getSettings()
      await saveSettings({ ...settings, stockPartners: [...selectedPartners] })
      renderStockList()
    },
  })
}

async function addPartner() {
  const name = await showPrompt({ title: 'Add Partner', placeholder: 'Partner name' })
  if (!name || !name.trim()) return
  const trimmed = name.trim()
  selectedPartners.add(trimmed)
  const settings = await getSettings()
  await saveSettings({ ...settings, stockPartners: [...selectedPartners] })
  renderStockList()
}

function escCsv(val) {
  if (val == null) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

async function showTradeReport() {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const defaultFrom = new Date(firstOfMonth)
  defaultFrom.setMonth(defaultFrom.getMonth() - 2)

  const content = `
    <div class="space-y-3 text-sm">
      <div>
        <label class="input-label">From Date</label>
        ${dateInputHTML({ id: 'tr-from', value: defaultFrom.toISOString().slice(0, 10) })}
      </div>
      <div>
        <label class="input-label">To Date</label>
        ${dateInputHTML({ id: 'tr-to', value: today.toISOString().slice(0, 10) })}
      </div>
    </div>
  `

  let result
  const modalPromise = showModal({
    title: 'Trade Report',
    content,
    confirmText: 'Generate CSV',
    onMounted: () => {
      setupDateInput('tr-from')
      setupDateInput('tr-to')
    },
    onConfirm: () => {
      const from = getDateInputValue('tr-from')
      const to = getDateInputValue('tr-to')
      if (!from || !to) { showToast('Please select both dates'); return false }
      result = { from, to }
    },
  })

  await modalPromise
  if (!result) return

  const entries = await getAllStockEntries()
  const symbolMap = {}
  for (const s of allStocks) symbolMap[s._id] = s.symbol

  const { from: fromDate, to: toDate } = result

  const rows = []
  for (const e of entries) {
    const name = symbolMap[e.stockId] || ''
    const buyInRange = e.date >= fromDate && e.date <= toDate
    const sellInRange = e.soldDate && e.soldDate >= fromDate && e.soldDate <= toDate
    if (buyInRange) rows.push({ date: e.date, name, type: 'B', qty: e.qty, price: e.price })
    if (sellInRange) rows.push({ date: e.soldDate, name, type: 'S', qty: e.qty, price: e.soldPrice })
  }

  if (rows.length === 0) {
    showToast('No trades found in selected range')
    return
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))

  const csv = 'Date,Name,Type,Qty,Price\n' + rows.map(r =>
    [escCsv(r.date), escCsv(r.name), r.type, escCsv(r.qty), escCsv(r.price)].join(',')
  ).join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trade_report_${fromDate}_to_${toDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`${filtered.length} trades exported`)
}

async function exportStockCSV() {
  const entries = await getAllStockEntries()
  const symbolMap = {}
  for (const s of allStocks) symbolMap[s._id] = s.symbol

  const symRows = allStocks.map(s =>
    [escCsv(s.symbol), escCsv(s.monthlyRate), escCsv(s.minReturn), escCsv(s.status || 'active')].join(',')
  ).join('\n')

  const entRows = entries.map(e =>
    [escCsv(symbolMap[e.stockId] || ''), escCsv(e.partnerName), escCsv(e.qty), escCsv(e.price), escCsv(e.date), escCsv(e.monthlyRate), escCsv(e.minReturn), escCsv(e.remainingQty), escCsv(e.status || 'holding'), escCsv(e.soldPrice), escCsv(e.soldDate)].join(',')
  ).join('\n')

  const csv = `=== Stock Symbols ===\nSymbol,MonthlyReturn,MinReturn,Status\n${symRows}\n\n=== Stock Entries ===\nSymbol,Partner,Qty,Price,Date,MonthlyReturn,MinReturn,RemainingQty,Status,SoldPrice,SoldDate\n${entRows}`

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'stock_data.csv'
  a.click()
  URL.revokeObjectURL(url)
  showToast('Stock data exported')
}

async function importStockCSV() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv'
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    const text = await file.text()
    const lines = text.split('\n').map(l => l.trim())
    let section = ''
    let importedSymbols = 0
    let importedEntries = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      if (line.startsWith('=== Stock Symbols')) { section = 'symbols'; continue }
      if (line.startsWith('=== Stock Entries')) { section = 'entries'; continue }
      if (line.startsWith('Symbol,')) continue

      if (section === 'symbols') {
        const parts = line.split(',').map(s => s.replace(/^"(.*)"$/, '$1').replace(/""/g, '"'))
        const symbol = parts[0]?.trim().toUpperCase()
        if (!symbol) continue
        const monthlyRate = parseFloat(parts[1]) || 2
        const minReturn = parseFloat(parts[2]) || 10
        const status = parts[3]?.trim() || 'active'
        const existing = allStocks.find(s => s.symbol === symbol)
        if (existing) {
          existing.monthlyRate = monthlyRate
          existing.minReturn = minReturn
          existing.status = status
          await saveStockSymbol(existing)
        } else {
          await saveStockSymbol({ symbol, monthlyRate, minReturn, status })
        }
        importedSymbols++
      } else if (section === 'entries') {
        allStocks = await getAllStockSymbols()
        const parts = line.split(',').map(s => s.replace(/^"(.*)"$/, '$1').replace(/""/g, '"'))
        const symbol = parts[0]?.trim().toUpperCase()
        const stock = allStocks.find(s => s.symbol === symbol)
        if (!stock) continue
        const entry = {
          stockId: stock._id,
          partnerName: parts[1]?.trim() || '',
          qty: parseInt(parts[2]) || 0,
          price: parseFloat(parts[3]) || 0,
          date: parts[4]?.trim() || '',
          monthlyRate: parseFloat(parts[5]) || stock.monthlyRate,
          minReturn: parseFloat(parts[6]) || stock.minReturn,
          remainingQty: parseInt(parts[7]) || parseInt(parts[2]),
          status: parts[8]?.trim() || 'holding',
          soldPrice: parts[9] ? parseFloat(parts[9]) : undefined,
          soldDate: parts[10]?.trim() || undefined,
        }
        if (!entry.qty || !entry.price || !entry.date) continue
        if (entry.status === 'sold') entry.remainingQty = 0
        await saveStockEntry(entry)
        importedEntries++
      }
    }

    allStocks = await getAllStockSymbols()
    allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
    renderStockList()
    showToast(`Imported ${importedSymbols} symbols, ${importedEntries} entries`)
    logAction('create', 'stock_import', '', `Imported ${importedSymbols} symbols, ${importedEntries} entries from CSV`)
  }
  input.click()
}

async function renderParetoAnalysis(entriesByStock) {
  const container = document.getElementById('stock-pareto')
  if (!container) return

  const holdingPareto = []
  for (const s of allStocks) {
    const entries = entriesByStock[s._id] || []
    const active = entries.filter(e => e.remainingQty > 0)
    const qty = calcTotalQty(active)
    const avg = calcAvgBuyPrice(active)
    const inv = qty * avg
    if (inv > 0) holdingPareto.push({ symbol: s.symbol, value: inv })
  }
  holdingPareto.sort((a, b) => b.value - a.value)

  const profitBySymbol = {}
  for (const s of allStocks) {
    const entries = entriesByStock[s._id] || []
    const sold = entries.filter(e => (!e.remainingQty || e.remainingQty <= 0) && e.soldPrice)
    for (const e of sold) {
      const p = (e.soldPrice - e.price) * e.qty
      if (p > 0) profitBySymbol[s.symbol] = (profitBySymbol[s.symbol] || 0) + p
    }
  }
  const soldPareto = Object.entries(profitBySymbol).map(([symbol, value]) => ({ symbol, value }))
  soldPareto.sort((a, b) => b.value - a.value)

  if (holdingPareto.length === 0 && soldPareto.length === 0) {
    container.innerHTML = ''
    return
  }

  container.innerHTML = `
    <div class="card-flat">
      <div class="flex items-center justify-between cursor-pointer select-none" id="pareto-toggle">
        <div class="flex items-center gap-2">
          <ion-icon name="stats-chart-outline" class="text-primary text-sm"></ion-icon>
          <span class="text-sm font-semibold">Pareto Analysis (80/20)</span>
        </div>
        <ion-icon name="chevron-down-outline" class="text-gray-400 transition-transform" id="pareto-chevron"></ion-icon>
      </div>
      <div id="pareto-body" class="mt-3 space-y-4 hidden">
        ${holdingPareto.length > 0 ? `
          <div>
            <div class="text-xs font-medium text-gray-500 mb-2">Holding — Investment Concentration</div>
            <div class="h-52" id="pareto-holding-chart"><canvas></canvas></div>
            <div class="text-xs text-gray-400 mt-1" id="pareto-holding-text"></div>
          </div>
        ` : ''}
        ${soldPareto.length > 0 ? `
          <div>
            <div class="text-xs font-medium text-gray-500 mb-2">Sold — Profit Concentration</div>
            <div class="h-52" id="pareto-sold-chart"><canvas></canvas></div>
            <div class="text-xs text-gray-400 mt-1" id="pareto-sold-text"></div>
          </div>
        ` : ''}
      </div>
    </div>
  `

  document.getElementById('pareto-toggle').addEventListener('click', () => {
    const body = document.getElementById('pareto-body')
    const chevron = document.getElementById('pareto-chevron')
    const wasHidden = body.classList.contains('hidden')
    body.classList.toggle('hidden')
    chevron.style.transform = body.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)'
    if (!wasHidden) return
    requestAnimationFrame(() => {
      initParetoChart('pareto-holding-chart', holdingPareto, 'Investment', '#6366f1', (v) => formatCurrencyFull(v),
        (d) => `Top ${d.count} of ${d.total} stocks (${d.pctOfTotal}%) hold ${d.pct80}% of total investment`)
      initParetoChart('pareto-sold-chart', soldPareto, 'Profit', '#10b981', (v) => formatCurrencyFull(v),
        (d) => `Top ${d.count} of ${d.total} stocks (${d.pctOfTotal}%) contributed ${d.pct80}% of total profit`)
    })
  })
}

function initParetoChart(elementId, data, label, color, fmtVal, textFn) {
  const el = document.getElementById(elementId)
  if (!el || data.length === 0) return
  const canvas = el.querySelector('canvas')
  if (!canvas) return

  const total = data.reduce((s, d) => s + d.value, 0)
  let cumSum = 0
  const cumData = data.map(d => { cumSum += d.value; return +((cumSum / total) * 100).toFixed(1) })

  cumSum = 0
  let count80 = 0
  for (const d of data) { cumSum += d.value; count80++; if (cumSum / total >= 0.8) break }
  const pct80 = +((cumSum / total) * 100).toFixed(1)
  const pctOfTotal = +((count80 / data.length) * 100).toFixed(1)

  const textEl = document.getElementById(elementId.replace('chart', 'text'))
  if (textEl) textEl.textContent = textFn({ count: count80, total: data.length, pct80, pctOfTotal })

  new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(d => d.symbol),
      datasets: [
        { label, data: data.map(d => d.value), backgroundColor: color, borderRadius: 3, order: 2 },
        {
          label: 'Cumulative %',
          data: cumData,
          type: 'line',
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#ef4444',
          tension: 0.3,
          order: 1,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 6, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1' ? ctx.parsed.y + '%' : fmtVal(ctx.parsed.y)),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 9 }, callback: (v) => v >= 100000 ? (v / 100000).toFixed(0) + 'L' : v } },
        y1: { beginAtZero: true, max: 100, position: 'right', grid: { display: false }, ticks: { font: { size: 9 }, callback: (v) => v + '%' } },
      },
    },
  })
}

async function deleteAllStockData() {
  const confirmed = await showConfirm({
    title: 'Delete All Stock Data?',
    message: 'This will permanently delete all stock symbols and all buy/sell entries. This cannot be undone.',
    confirmText: 'Delete Everything',
    danger: true,
  })
  if (!confirmed) return

  const entries = await getAllStockEntries()
  for (const e of entries) {
    await deleteStockEntry(e._id)
  }
  for (const s of allStocks) {
    await deleteStockSymbol(s._id)
  }

  logAction('delete', 'stock_data', '', `Deleted ${entries.length} entries and ${allStocks.length} symbols`)
  showToast(`Deleted ${allStocks.length} symbols and ${entries.length} entries`)

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
}

async function renderTradeViewerTrigger() {
  const el = document.getElementById('stock-trade-viewer')
  if (!el) return
  el.innerHTML = `
    <div class="card-flat cursor-pointer" id="trade-viewer-trigger">
      <div class="flex items-center gap-2">
        <ion-icon name="calendar-outline" class="text-primary text-sm"></ion-icon>
        <span class="text-sm font-semibold">View Trades by Date</span>
      </div>
    </div>
  `
  el.querySelector('#trade-viewer-trigger').addEventListener('click', () => showTradeByDateModal())
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

async function showTradeByDateModal() {
  const today = new Date().toISOString().split('T')[0]

  async function renderTradeContent(dateStr) {
    const allEntries = await getAllStockEntries()
    const symbolMap = {}
    for (const s of allStocks) symbolMap[s._id] = s.symbol

    const rows = []
    for (const e of allEntries) {
      if (e.date === dateStr) {
        rows.push({ partnerName: e.partnerName || '', symbol: symbolMap[e.stockId] || '', trade: 'B', qty: e.qty, price: e.price })
      }
      if (e.soldDate === dateStr && e.status === 'sold') {
        rows.push({ partnerName: e.partnerName || '', symbol: symbolMap[e.stockId] || '', trade: 'S', qty: e.qty, price: e.soldPrice })
      }
    }

    rows.sort((a, b) => {
      const pc = (a.partnerName || '').localeCompare(b.partnerName || '')
      if (pc !== 0) return pc
      return (a.symbol || '').localeCompare(b.symbol || '')
    })

    const body = document.getElementById('trade-date-body')
    if (!body) return

    if (rows.length === 0) {
      body.innerHTML = '<p class="text-xs text-gray-400 text-center py-6">No trades found for this date</p>'
      return
    }

    body.innerHTML = `
      <table class="w-full text-xs">
        <thead><tr class="text-gray-400 border-b border-gray-100">
          <th class="text-left py-1.5 pr-1">Partner</th>
          <th class="text-left py-1.5 pr-1">Stock</th>
          <th class="text-center py-1.5 pr-1">Trade</th>
          <th class="text-right py-1.5 pr-1">Qty</th>
          <th class="text-right py-1.5">Price</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr class="border-b border-gray-50">
            <td class="py-1.5 pr-1 text-gray-600">${escHtml(r.partnerName)}</td>
            <td class="py-1.5 pr-1 font-semibold">${escHtml(r.symbol)}</td>
            <td class="py-1.5 pr-1 text-center"><span class="inline-block w-5 h-5 rounded text-xs font-bold leading-5 ${r.trade === 'B' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${r.trade}</span></td>
            <td class="py-1.5 pr-1 text-right font-mono">${r.qty}</td>
            <td class="py-1.5 text-right font-mono">${formatCurrencyFull(r.price)}</td>
          </tr>
        `).join('')}</tbody>
      </table>
      <div class="text-[10px] text-gray-400 text-center pt-2">${rows.length} trade${rows.length !== 1 ? 's' : ''}</div>
    `
  }

  const dateId = 'trade-date'

  const content = `
    <div>
      <div class="flex items-center gap-1.5 mb-3">
        <button class="btn-ghost text-xs px-2 py-1" id="trade-prev-day"><ion-icon name="chevron-back-outline"></ion-icon></button>
        ${dateInputHTML({id: dateId, value: today})}
        <button class="btn-ghost text-xs px-2 py-1" id="trade-next-day"><ion-icon name="chevron-forward-outline"></ion-icon></button>
      </div>
      <div id="trade-date-body" class="max-h-80 overflow-y-auto"></div>
    </div>
  `

  await showModal({
    title: 'Trades by Date',
    content,
    confirmText: 'Close',
    showCancel: false,
    onMounted: () => {
      setupDateInput(dateId)
      renderTradeContent(today)

      document.getElementById('trade-prev-day').addEventListener('click', () => {
        const cur = getDateInputValue(dateId) || today
        const newDate = shiftDate(cur, -1)
        setDateInputValue(dateId, newDate)
        renderTradeContent(newDate)
      })
      document.getElementById('trade-next-day').addEventListener('click', () => {
        const cur = getDateInputValue(dateId) || today
        const newDate = shiftDate(cur, 1)
        setDateInputValue(dateId, newDate)
        renderTradeContent(newDate)
      })
      document.getElementById(dateId).addEventListener('change', () => {
        const val = getDateInputValue(dateId)
        if (val) renderTradeContent(val)
      })
      document.getElementById(dateId + '-native').addEventListener('change', () => {
        const val = getDateInputValue(dateId)
        if (val) renderTradeContent(val)
      })
    },
  })
}

function getMonthLabel(ym) {
  const d = new Date(ym + '-01T00:00:00')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[d.getMonth()] + ' ' + d.getFullYear().toString().slice(-2)
}

function calcPnL(e) {
  return e.soldPrice ? (e.soldPrice - e.price) * e.qty : 0
}

function calcXIRR(entries) {
  if (entries.length === 0) return '—'
  const flows = []
  let earliest = null
  for (const e of entries) {
    const buy = new Date(e.date + 'T00:00:00')
    const sell = new Date(e.soldDate + 'T00:00:00')
    if (!earliest || buy < earliest) earliest = buy
    flows.push({ date: buy, amount: -e.qty * e.price })
    flows.push({ date: sell, amount: e.qty * e.soldPrice })
  }
  if (!earliest) return '—'
  flows.sort((a, b) => a.date - b.date)
  const days = flows.map(f => (f.date - earliest) / 86400000)
  const amounts = flows.map(f => f.amount)
  let rate = 0.1
  for (let i = 0; i < 100; i++) {
    let f = 0, df = 0
    for (let j = 0; j < amounts.length; j++) {
      const t = days[j] / 365
      const denom = Math.pow(1 + rate, t)
      f += amounts[j] / denom
      df -= amounts[j] * t / Math.pow(1 + rate, t + 1)
    }
    if (Math.abs(f) < 1e-8) break
    const newRate = rate - f / df
    if (newRate <= -0.9999) { rate = -0.9999; break }
    rate = newRate
  }
  return (rate * 100).toFixed(1)
}

function calcMonthlyInterest(entries, monthlyRate) {
  if (entries.length === 0) return { months: [], totalInterest: 0 }
  const dailyRate = monthlyRate / 30 / 100

  const activeKeys = new Set()
  for (const e of entries) {
    if (e.remainingQty > 0) {
      activeKeys.add(e.stockId + '|' + e.date + '|' + e.price)
    }
  }

  function isLifo(e) {
    return e._lifoSplit || (e.status === 'sold' && e.remainingQty === 0 && activeKeys.has(e.stockId + '|' + e.date + '|' + e.price))
  }

  const lifoSoldQty = {}
  for (const e of entries) {
    if (isLifo(e) && e.status === 'sold') {
      const key = e.stockId + '|' + e.date + '|' + e.price
      lifoSoldQty[key] = (lifoSoldQty[key] || 0) + e.qty
    }
  }

  const events = []
  for (const e of entries) {
    if (isLifo(e)) {
      if (e.status === 'sold' && e.soldDate) {
        events.push({ date: new Date(e.soldDate + 'T00:00:00'), amount: -(e.qty * e.price) })
      }
    } else {
      events.push({ date: new Date(e.date + 'T00:00:00'), amount: e.qty * e.price })
      if (e.status === 'sold' && e.soldDate) {
        const key = e.stockId + '|' + e.date + '|' + e.price
        const alreadySold = lifoSoldQty[key] || 0
        const sellQty = e.qty - alreadySold
        if (sellQty > 0) {
          events.push({ date: new Date(e.soldDate + 'T00:00:00'), amount: -(sellQty * e.price) })
        }
      }
    }
  }
  if (events.length === 0) return { months: [], totalInterest: 0 }
  events.sort((a, b) => a.date - b.date)

  const first = events[0].date
  const last = events[events.length - 1].date
  const hasActive = entries.some(e => e.remainingQty > 0)
  const ref = hasActive ? new Date(Math.max(last.getTime(), Date.now())) : last
  const startMonth = new Date(first.getFullYear(), first.getMonth(), 1)
  const endMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)

  const byMonth = {}
  let outstanding = 0
  let eventIdx = 0

  for (let m = new Date(startMonth); m < endMonth; m.setMonth(m.getMonth() + 1)) {
    const mk = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0')
    const monthEnd = new Date(m.getFullYear(), m.getMonth() + 1, 1)
    let prev = new Date(m)

    while (eventIdx < events.length) {
      const ev = events[eventIdx]
      if (ev.date >= monthEnd) break
      if (ev.date >= prev && outstanding > 0) {
        const days = (ev.date - prev) / 86400000
        if (days > 0) byMonth[mk] = (byMonth[mk] || 0) + outstanding * dailyRate * days
      }
      outstanding += ev.amount
      prev = ev.date
      eventIdx++
    }

    if (outstanding > 0) {
      const monthLast = new Date(m.getFullYear(), m.getMonth() + 1, 0)
      const days = Math.max(0, (monthLast - prev) / 86400000)
      if (days > 0) byMonth[mk] = (byMonth[mk] || 0) + outstanding * dailyRate * days
    }
  }

  const allMonths = Object.entries(byMonth)
    .map(([ym, interest]) => ({ ym, interest: Math.round(interest) }))
    .sort((a, b) => a.ym.localeCompare(b.ym))
  const totalInterest = Object.values(byMonth).reduce((s, v) => s + v, 0)
  return { allMonths, totalInterest: Math.round(totalInterest) }
}

function calcMonthlyPnL(entries) {
  const byMonth = {}
  for (const e of entries) {
    if (!e.soldDate || e.status !== 'sold') continue
    const m = e.soldDate.slice(0, 7)
    byMonth[m] = (byMonth[m] || 0) + calcPnL(e)
  }
  const result = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    result.push({ ym: key, pnl: byMonth[key] || 0 })
  }
  return result
}

function calcYearlyPnL(entries) {
  const byYear = {}
  for (const e of entries) {
    if (!e.soldDate || e.status !== 'sold') continue
    const y = e.soldDate.slice(0, 4)
    byYear[y] = (byYear[y] || 0) + calcPnL(e)
  }
  return Object.entries(byYear)
    .map(([y, pnl]) => ({ year: parseInt(y), pnl }))
    .sort((a, b) => a.year - b.year)
}

async function renderAnalysisSection() {
  const el = document.getElementById('stock-analysis')
  if (!el) return

  el.innerHTML = `
    <div class="card-flat">
      <div class="flex items-center justify-between cursor-pointer select-none" id="analysis-toggle">
        <div class="flex items-center gap-2">
          <ion-icon name="analytics-outline" class="text-primary text-sm"></ion-icon>
          <span class="text-sm font-semibold">Analysis</span>
        </div>
        <ion-icon name="chevron-down-outline" class="text-gray-400 transition-transform" id="analysis-chevron"></ion-icon>
      </div>
      <div id="analysis-body" class="mt-3 hidden">
        <div class="flex gap-2 mb-3">
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-primary text-white" data-tab="interest">Interest</button>
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600" data-tab="targets">Targets</button>
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600" data-tab="returns">Returns</button>
        </div>
        <div id="analysis-content">
          <div class="text-xs text-gray-400 text-center py-4">Open to load analysis</div>
        </div>
      </div>
    </div>
  `

  let loaded = false

  document.getElementById('analysis-toggle').addEventListener('click', async () => {
    const body = document.getElementById('analysis-body')
    const chevron = document.getElementById('analysis-chevron')
    const wasHidden = body.classList.contains('hidden')
    body.classList.toggle('hidden')
    chevron.style.transform = body.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)'
    if (!wasHidden || loaded) return
    loaded = true
    await renderInterestTab()
  })

  document.querySelectorAll('.analysis-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.analysis-tab').forEach(t => {
        t.className = 'analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600'
      })
      btn.className = 'analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-primary text-white'
      const tab = btn.dataset.tab
      if (tab === 'returns') await renderReturnsTab()
      else if (tab === 'targets') await renderTargetsTab()
      else if (tab === 'interest') await renderInterestTab()
    })
  })
}

async function renderReturnsTab() {
  const content = document.getElementById('analysis-content')
  if (!content) return

  const allEntries = await getAllStockEntries()
  const soldEntries = allEntries.filter(e => e.soldDate && e.status === 'sold')
  const activeEntries = allEntries.filter(e => e.remainingQty > 0)
  const monthly = calcMonthlyPnL(allEntries)
  const yearly = calcYearlyPnL(allEntries)
  const totalPnL = soldEntries.reduce((s, e) => s + calcPnL(e), 0)
  const winCount = soldEntries.filter(e => calcPnL(e) > 0).length
  const lossCount = soldEntries.filter(e => calcPnL(e) < 0).length
  const totalTrades = soldEntries.length
  const winRate = totalTrades > 0 ? (winCount / totalTrades * 100).toFixed(0) : 0
  const avgReturn = totalTrades > 0 ? formatCurrencyFull(totalPnL / totalTrades) : '₹0'
  const totalInvested = soldEntries.reduce((s, e) => s + e.qty * e.price, 0)
  const returnPct = totalInvested > 0 ? (totalPnL / totalInvested * 100).toFixed(1) : 0

  let annualizedReturn = '—'
  let avgHoldingDays = 0
  if (soldEntries.length > 0) {
    let totalDays = 0
    for (const e of soldEntries) {
      const buy = new Date(e.date + 'T00:00:00')
      const sell = new Date((e.soldDate || e.date) + 'T00:00:00')
      totalDays += Math.max(1, (sell - buy) / 86400000)
    }
    avgHoldingDays = totalDays / soldEntries.length
    annualizedReturn = calcXIRR(soldEntries)
  }

  const activeCost = activeEntries.reduce((s, e) => s + e.remainingQty * e.price, 0)
  let unrealizedPnL = 0
  for (const e of activeEntries) {
    const days = calcDaysHeld(e.date)
    const cv = calcCurrentValue(e.price, e.monthlyRate, e.minReturn, days)
    unrealizedPnL += (cv - e.price) * e.remainingQty
  }
  const totalDeployed = totalInvested + activeCost
  const portfolioPnL = totalPnL + unrealizedPnL
  const portfolioReturn = totalDeployed > 0 ? (portfolioPnL / totalDeployed * 100).toFixed(1) : '—'

  content.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-2 text-xs" id="metrics-grid">
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="realized-pnl">
          <div class="text-gray-400">Total Realized P&amp;L</div>
          <div class="font-semibold font-mono ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(totalPnL)}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="portfolio-return">
          <div class="text-gray-400">Portfolio Return</div>
          <div class="font-semibold ${portfolioPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${portfolioReturn}%</div>
          <div class="text-[9px] text-gray-400">Realized + Unrealized</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="annualized-return">
          <div class="text-gray-400">Annualized Return</div>
          <div class="font-semibold ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${annualizedReturn}%</div>
          <div class="text-[9px] text-gray-400">${avgHoldingDays > 0 ? Math.round(avgHoldingDays) + 'd avg hold' : '—'}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="realized-roi">
          <div class="text-gray-400">Realized ROI</div>
          <div class="font-semibold ${returnPct >= 0 ? 'text-green-600' : 'text-red-600'}">${returnPct}%</div>
          <div class="text-[9px] text-gray-400">Simple (no time factor)</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="win-rate">
          <div class="text-gray-400">Win Rate</div>
          <div class="font-semibold">${winRate}% <span class="font-normal text-gray-400">(${winCount}W / ${lossCount}L)</span></div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="avg-return">
          <div class="text-gray-400">Avg Return / Trade</div>
          <div class="font-semibold font-mono">${avgReturn}</div>
        </div>
      </div>

      ${monthly.length > 0 ? `
      <div>
        <div class="text-xs font-medium text-gray-500 mb-2">Monthly Realized P&amp;L (Last 12 Months)</div>
        <div class="h-44" id="monthly-chart"><canvas></canvas></div>
      </div>
      ` : ''}

      ${yearly.length > 0 ? `
      <div>
        <div class="text-xs font-medium text-gray-500 mb-2">Yearly Realized P&amp;L</div>
        <div class="h-44" id="yearly-chart"><canvas></canvas></div>
      </div>
      ` : ''}

      ${soldEntries.length === 0 ? '<p class="text-xs text-gray-400 text-center py-4">No sold trades yet</p>' : ''}
    </div>
  `

  requestAnimationFrame(() => {
    if (monthly.length > 0) {
      const canvas = document.querySelector('#monthly-chart canvas')
      if (canvas) {
        const colors = monthly.map(m => m.pnl >= 0 ? '#10b981' : '#ef4444')
        new window.Chart(canvas, {
          type: 'bar',
          data: {
            labels: monthly.map(m => getMonthLabel(m.ym)),
            datasets: [{ label: 'P&L', data: monthly.map(m => m.pnl), backgroundColor: colors, borderRadius: 3 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatCurrencyFull(ctx.parsed.y) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 } } },
              y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 9 }, callback: (v) => formatCurrency(v) } },
            },
          },
        })
      }
    }
    if (yearly.length > 0) {
      const canvas = document.querySelector('#yearly-chart canvas')
      if (canvas) {
        const colors = yearly.map(y => y.pnl >= 0 ? '#6366f1' : '#ef4444')
        new window.Chart(canvas, {
          type: 'bar',
          data: {
            labels: yearly.map(y => y.year),
            datasets: [{ label: 'P&L', data: yearly.map(y => y.pnl), backgroundColor: colors, borderRadius: 3 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatCurrencyFull(ctx.parsed.y) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 } } },
              y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 9 }, callback: (v) => formatCurrency(v) } },
            },
          },
        })
      }
    }

    document.querySelectorAll('[data-explain]').forEach(el => {
      el.addEventListener('click', () => showMetricExplanation(el.dataset.explain))
    })
  })
}

function showMetricExplanation(key) {
  const explanations = {
    'realized-pnl': {
      title: 'Total Realized P&L',
      body: 'Sum of all profits and losses from closed (sold) trades.\n\nFormula:\nΣ (SoldPrice − BuyPrice) × Qty\nfor every stock entry where status = "sold".\n\nA positive number means you made money on your closed trades overall.',
    },
    'portfolio-return': {
      title: 'Portfolio Return',
      body: 'Total return on ALL capital deployed — both closed trades and current holdings.\n\nFormula:\n(Realized P&L + Unrealized P&L) / Total Cost Basis × 100\n\nRealized P&L: profits from sold trades\nUnrealized P&L: calculated gain on holdings still active\n  (CurrentValue − BuyPrice) × RemainingQty\n\nThis tells you how your entire portfolio is performing right now.',
    },
    'annualized-return': {
      title: 'Annualized Return (XIRR)',
      body: 'Calculated using the XIRR (Extended Internal Rate of Return) method — the industry-standard approach used by mutual funds and portfolio managers.\n\nHow it works:\n1. Every buy is treated as a cash outflow (−Qty × Price)\n2. Every sell is treated as a cash inflow (+Qty × SoldPrice)\n3. All cash flows are placed on their actual dates\n4. XIRR finds the single annualized rate that makes Net Present Value = 0\n\nWhy XIRR is better:\n• No arbitrary minimum-day floors\n• Handles irregular holding periods naturally\n• Short trades don\'t mathematically explode to infinity\n• Matches Excel\'s XIRR function\n\nFormula:\nΣ CFᵢ / (1 + r)^(tᵢ/365) = 0\n→ solved for r using Newton\'s method',
    },
    'realized-roi': {
      title: 'Realized ROI (Simple)',
      body: 'Raw percentage return on closed trades, ignoring time.\n\nFormula:\nTotal Realized P&L / Total Cost Basis × 100\n\nThis does NOT account for how long the money was invested.\nUse Annualized Return for a time-fair comparison.',
    },
    'win-rate': {
      title: 'Win Rate',
      body: 'Percentage of closed trades that were profitable.\n\nFormula:\n(Number of profitable trades / Total number of trades) × 100\n\nW = trades with P&L > 0\nL = trades with P&L < 0 (trades with exactly ₹0 are excluded)\n\nA high win rate alone doesn\'t guarantee profits — a few big wins can outweigh many small losses.',
    },
    'avg-return': {
      title: 'Avg Return / Trade',
      body: 'Average profit or loss per closed trade.\n\nFormula:\nTotal Realized P&L / Total number of closed trades\n\nThis gives a sense of whether your typical trade is worth the effort.\nIt smooths out the difference between big winners and small losers.',
    },
    'interest-total': {
      title: 'Total Interest Charged',
      body: 'Hypothetical interest calculated on the capital deployed in each trade, as if you were charging the target monthly rate on the outstanding balance.\n\nHow it works:\n1. Every Buy adds to the outstanding balance (Debit)\n2. Every Sell reduces the outstanding balance (Credit)\n3. Interest = Outstanding × Days × (MonthlyRate / 30 / 100)\n4. Days = time between consecutive transactions\n5. For the last transaction in a month, interest runs to end of month\n\nThe monthly rate defaults to 2% if no target is set in the Targets tab.\n\nThis measures: "What would my returns be at the target rate?"',
    },
    'interest-excess': {
      title: 'Excess Return',
      body: 'Actual Total Realized P&L minus the hypothetical interest.\n\nFormula:\nTotal Realized P&L − Total Interest Charged\n\nIf positive (green): Your actual trading beat the target rate.\nIf negative (red): Your actual trading underperformed vs the target rate.\n\nThis is your "alpha" — the extra return you generated beyond what a simple interest-based return would have given you.',
    },
  }

  const info = explanations[key]
  if (!info) return

  showModal({
    title: info.title,
    content: `<div class="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">${info.body}</div>`,
    confirmText: 'Got it',
    showCancel: false,
  })
}

async function renderTargetsTab() {
  const content = document.getElementById('analysis-content')
  if (!content) return

  const settings = await getSettings()
  const monthlyTargetPct = parseFloat(settings.stockMonthlyTargetPct) || 0

  const allEntries = await getAllStockEntries()
  const soldEntries = allEntries.filter(e => e.soldDate && e.status === 'sold')

  const annualTargetSimple = monthlyTargetPct * 12
  const annualTargetCAGR = monthlyTargetPct > 0 ? ((1 + monthlyTargetPct / 100) ** 12 - 1) * 100 : 0

  const xirrVal = calcXIRR(soldEntries)
  const xirrNum = xirrVal !== '—' ? parseFloat(xirrVal) : null
  const actualMonthlyCAGR = xirrNum !== null ? ((1 + xirrNum / 100) ** (1 / 12) - 1) * 100 : null

  const monthPct = monthlyTargetPct > 0 && actualMonthlyCAGR !== null
    ? Math.min(100, (actualMonthlyCAGR / monthlyTargetPct * 100)).toFixed(0) : 0
  const yearPct = monthlyTargetPct > 0 && xirrNum !== null
    ? Math.min(100, (xirrNum / annualTargetSimple * 100)).toFixed(0) : 0

  const targetSet = monthlyTargetPct > 0

  content.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="text-xs text-gray-400 block mb-1">Monthly Return Target (%)</label>
        <input class="input text-xs" id="target-monthly-pct" type="number" step="0.1" min="0" max="100"
          value="${monthlyTargetPct || ''}" placeholder="e.g. 2" />
        <div class="text-[10px] text-gray-400 mt-1">
          ${monthlyTargetPct > 0 ? `
            Annual target: ${annualTargetSimple.toFixed(0)}% simple &middot; ${annualTargetCAGR.toFixed(1)}% CAGR
          ` : 'Set a monthly % target above'}
        </div>
      </div>
      <button class="btn-primary text-xs w-full py-1.5" id="save-targets-btn">Save Target</button>

      ${xirrNum === null ? '<p class="text-xs text-gray-400 text-center py-3">No sold trades yet</p>' : `
      <hr class="border-gray-100">
      <div class="space-y-3">
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-500">Monthly Return (CAGR)</span>
            <span class="font-mono font-semibold ${actualMonthlyCAGR >= 0 ? 'text-green-600' : 'text-red-600'}">
              ${actualMonthlyCAGR.toFixed(2)}%
              ${targetSet ? '/ ' + monthlyTargetPct.toFixed(1) + '% target' : ''}
            </span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ${actualMonthlyCAGR >= 0 ? 'bg-green-500' : 'bg-red-400'}" style="width:${targetSet ? monthPct : 100}%"></div>
          </div>
          <div class="text-right text-[10px] text-gray-400 mt-0.5">
            ${targetSet ? monthPct + '% of target' : (actualMonthlyCAGR >= 0 ? '+' : '') + actualMonthlyCAGR.toFixed(2) + '% / mo'}
          </div>
        </div>

        <div>
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-500">Annual Return (XIRR)</span>
            <span class="font-mono font-semibold ${xirrNum >= 0 ? 'text-green-600' : 'text-red-600'}">
              ${xirrVal}%
              ${targetSet ? '/ ' + annualTargetSimple.toFixed(0) + '% target' : ''}
            </span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ${xirrNum >= 0 ? 'bg-indigo-500' : 'bg-red-400'}" style="width:${targetSet ? yearPct : 100}%"></div>
          </div>
          <div class="text-right text-[10px] text-gray-400 mt-0.5">
            ${targetSet ? yearPct + '% of target' : xirrVal + '% / yr'}
          </div>
        </div>
      </div>
      `}
    </div>
  `

  document.getElementById('save-targets-btn').addEventListener('click', async () => {
    const pct = parseFloat(document.getElementById('target-monthly-pct')?.value) || 0
    const s = await getSettings()
    s.stockMonthlyTargetPct = pct
    await saveSettings(s)
    showToast('Target saved')
    await renderTargetsTab()
  })
}



async function renderInterestTab() {
  const content = document.getElementById('analysis-content')
  if (!content) return

  const settings = await getSettings()
  const monthlyRate = parseFloat(settings.stockMonthlyTargetPct) || 2

  const allEntries = await getAllStockEntries()
  const soldEntries = allEntries.filter(e => e.soldDate && e.status === 'sold')
  const totalRealizedPnL = soldEntries.reduce((s, e) => s + calcPnL(e), 0)

  const { allMonths, totalInterest } = calcMonthlyInterest(allEntries, monthlyRate)

  const diff = Math.round(totalRealizedPnL) - totalInterest
  const diffPct = totalInterest > 0 ? ((diff / totalInterest) * 100).toFixed(1) : 0

  const monthlyPnL = calcMonthlyPnL(allEntries)
  const pnlByMonth = {}
  for (const m of monthlyPnL) pnlByMonth[m.ym] = m.pnl

  const years = [...new Set(allMonths.map(m => m.ym.slice(0, 4)))].sort()
  const now = new Date()
  const curYear = now.getFullYear()
  let activeYear = years.includes(String(curYear)) ? curYear : Math.max(...years.map(Number))

  function renderView(year) {
    const yearMonths = allMonths.filter(m => m.ym.startsWith(String(year)))
    const yearPnL = yearMonths.reduce((s, m) => s + Math.round(pnlByMonth[m.ym] || 0), 0)
    const yearInt = yearMonths.reduce((s, m) => s + m.interest, 0)

    content.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-2 text-xs" id="interest-metrics">
          <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="interest-total">
            <div class="text-gray-400">Total Interest Charged</div>
            <div class="font-semibold font-mono text-indigo-600">${formatCurrencyFull(totalInterest)}</div>
            <div class="text-[9px] text-gray-400">at ${monthlyRate}% per month</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2.5 cursor-pointer" data-explain="interest-excess">
            <div class="text-gray-400">Excess Return</div>
            <div class="font-semibold font-mono ${diff >= 0 ? 'text-green-600' : 'text-red-600'}">${diff >= 0 ? '+' : ''}${formatCurrencyFull(diff)}</div>
            <div class="text-[9px] text-gray-400">Actual P&amp;L − Interest (${diffPct}%)</div>
          </div>
        </div>

        ${soldEntries.length === 0 ? '<p class="text-xs text-gray-400 text-center py-4">No sold trades yet</p>' : `
        <div class="flex items-center justify-center gap-2 text-xs">
          <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium year-nav-btn" data-year="${year - 1}" ${!years.includes(String(year - 1)) ? 'disabled style="opacity:0.3"' : ''}>&larr;</button>
          <input type="number" class="w-16 text-center border rounded px-1 py-0.5 font-mono text-sm year-input" value="${year}" min="${years[0]}" max="${years[years.length - 1]}" />
          <button class="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium year-nav-btn" data-year="${year + 1}" ${!years.includes(String(year + 1)) ? 'disabled style="opacity:0.3"' : ''}>&rarr;</button>
        </div>

        <div>
          <div class="text-xs font-medium text-gray-500 mb-2">Monthly P&amp;L vs Interest (${year})</div>
          <div class="h-48" id="interest-chart"><canvas></canvas></div>
        </div>
        <div class="text-xs text-gray-400">
          <span class="inline-block w-3 h-3 rounded-sm bg-emerald-500 align-middle mr-1"></span> Actual P&amp;L
          <span class="inline-block w-3 h-3 rounded-sm bg-indigo-400 align-middle mr-1 ml-3"></span> Interest at ${monthlyRate}%
        </div>

        <div class="text-xs space-y-1">
          <div class="font-medium text-gray-500 mb-1">Month-wise Breakdown (${year})</div>
          ${yearMonths.map(m => {
            const pnl = Math.round(pnlByMonth[m.ym] || 0)
            return '<div class="flex justify-between py-1 border-b border-gray-50">'
              + '<span class="text-gray-500">' + getMonthLabel(m.ym) + '</span>'
              + '<span class="font-mono ' + (pnl >= 0 ? 'text-green-600' : 'text-red-600') + '">' + formatCurrencyFull(pnl) + '</span>'
              + '<span class="font-mono text-indigo-500">' + formatCurrencyFull(m.interest) + '</span>'
              + '</div>'
          }).join('')}
          <div class="flex justify-between py-1 font-medium border-t border-gray-300">
            <span class="text-gray-700">Total</span>
            <span class="font-mono ${yearPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(yearPnL)}</span>
            <span class="font-mono text-indigo-600">${formatCurrencyFull(yearInt)}</span>
          </div>
        </div>
        `}
      </div>
    `

    if (yearMonths.length > 0) {
      requestAnimationFrame(() => {
        const canvas = document.querySelector('#interest-chart canvas')
        if (!canvas) return
        const labels = yearMonths.map(m => getMonthLabel(m.ym))
        const pnlData = yearMonths.map(m => Math.round(pnlByMonth[m.ym] || 0))
        const intData = yearMonths.map(m => m.interest)
        new window.Chart(canvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'P&L', data: pnlData, backgroundColor: '#10b981', borderRadius: 3 },
              { label: 'Interest', data: intData, backgroundColor: '#818cf8', borderRadius: 3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => ctx.dataset.label + ': ' + formatCurrencyFull(ctx.parsed.y),
                },
              },
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 } } },
              y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 9 }, callback: (v) => formatCurrency(v) } },
            },
          },
        })
      })
    }

    document.querySelectorAll('[data-explain]').forEach(el => {
      el.addEventListener('click', () => showMetricExplanation(el.dataset.explain))
    })
    document.querySelectorAll('.year-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) { activeYear = parseInt(btn.dataset.year); renderView(activeYear) }
      })
    })
    document.querySelector('.year-input')?.addEventListener('change', function () {
      const y = parseInt(this.value)
      if (!isNaN(y) && y >= parseInt(this.min) && y <= parseInt(this.max)) {
        activeYear = y; renderView(activeYear)
      } else {
        this.value = activeYear
      }
    })
  }

  renderView(activeYear)
}

async function showAddStockForm() {
  const existingSymbols = allStocks.map(s => s.symbol)

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Stock Symbol *</label>
        <input class="input uppercase" id="sf-symbol" placeholder="e.g. RELIANCE" list="stock-suggest" />
        <datalist id="stock-suggest">${existingSymbols.map(s => `<option value="${escHtml(s)}">`).join('')}</datalist>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Monthly Return <span class="text-[10px] text-gray-400">(R)</span> *</label>
          <input class="input" id="sf-r" type="number" step="0.1" value="2" />
        </div>
        <div>
          <label class="input-label">Min Return <span class="text-[10px] text-gray-400">(M)</span> *</label>
          <input class="input" id="sf-m" type="number" step="0.1" value="10" />
        </div>
      </div>
      <div>
        <label class="input-label">Status</label>
        <select class="input" id="sf-status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Add Stock',
    content,
    confirmText: 'Add',
    onConfirm: () => {
      const symbol = document.getElementById('sf-symbol')?.value.trim().toUpperCase()
      const r = parseFloat(document.getElementById('sf-r')?.value)
      const m = parseFloat(document.getElementById('sf-m')?.value)
      const status = document.getElementById('sf-status')?.value || 'active'
      if (!symbol) { showToast('Stock symbol is required', 'error'); return false }
      if (allStocks.some(s => s.symbol === symbol)) { showToast('Stock already exists', 'error'); return false }
      if (!r || r <= 0) { showToast('Monthly return is required', 'error'); return false }
      if (!m || m <= 0) { showToast('Min return is required', 'error'); return false }
      return { symbol, monthlyRate: r, minReturn: m, status }
    },
  })

  if (!result || result === true) return

  await saveStockSymbol(result)
  logAction('create', 'stock', '', `Added stock symbol: ${result.symbol} (R:${result.monthlyRate}, M:${result.minReturn})`)
  showToast('Stock added')

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
}

async function showStrategyForStock(stockId) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return
  showCreateStrategy(stockId)
}

async function showCreateStrategy(stockId) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return
  const entries = await getStockEntries(stockId)
  const soldEntries = entries.filter(e => e.status === 'sold' && e.soldDate)
  const activeEntries = entries.filter(e => e.remainingQty > 0)
  const { SQ, ASP } = computeStockSoldMetrics(entries)
  if (SQ === 0) { showToast('No sold trades found for this stock'); return }

  const defaultMBP = Math.round(ASP * 100) / 100
  let params = { SQ, ASP, MBP: defaultMBP, buybackRatio: 2/3, targetAvgFactor: 0.9, granularity: 1, type: '1234' }
  let label = stock.symbol + '_1234'

  function renderPreview() {
    const r = calc1234Lots(params)
    const existing = computeExistingHoldings(r.lots, activeEntries)
    const totalExisting = existing.reduce((s, l) => s + l.existing, 0)
    const overlapCost = existing.reduce((s, l) => s + l.existing * l.price, 0)
    const newCapital = r.totalCost - overlapCost
    return `
      <div class="border-t border-gray-200 pt-3 mt-2">
        <div class="grid grid-cols-2 gap-2 text-xs mb-3">
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Total Investment</div>
            <div class="font-semibold font-mono text-gray-800">${formatCurrencyFull(r.totalCost)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Target Avg Price</div>
            <div class="font-semibold font-mono text-indigo-600">${formatCurrencyFull(r.avgPrice)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Range</div>
            <div class="font-semibold font-mono text-gray-800">${r.rangeHigh} – ${r.rangeLow}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Lots</div>
            <div class="font-semibold font-mono text-gray-800">${r.lots.length}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Existing Overlap</div>
            <div class="font-semibold font-mono text-amber-600">${totalExisting} units</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">New Capital Needed</div>
            <div class="font-semibold font-mono text-green-600">${formatCurrencyFull(Math.max(0, newCapital))}</div>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="text-gray-400 border-b border-gray-100">
              <th class="text-left py-1 pr-1">Qty</th>
              <th class="text-right py-1 pr-1">Price</th>
              <th class="text-right py-1 pr-1">Existing</th>
              <th class="text-right py-1">Subtotal</th>
            </tr></thead>
            <tbody>${existing.map(l => {
              const subtotal = l.qty * l.price
              const highlight = l.existing > 0 ? 'bg-amber-50' : ''
              return `<tr class="border-b border-gray-50 ${highlight}">
                <td class="py-1 pr-1">${l.qty}</td>
                <td class="py-1 pr-1 text-right font-mono">${l.price.toFixed(1)}</td>
                <td class="py-1 pr-1 text-right font-mono ${l.existing > 0 ? 'text-amber-600 font-semibold' : ''}">${l.existing}</td>
                <td class="py-1 text-right font-mono">${formatCurrencyFull(subtotal)}</td>
              </tr>`
            }).join('')}</tbody>
            <tfoot><tr class="font-medium">
              <td class="py-1 pr-1 border-t-2 border-gray-400">${r.totalQty}</td>
              <td class="py-1 pr-1 text-right font-mono border-t-2 border-gray-400">${r.avgPrice.toFixed(1)}</td>
              <td class="py-1 pr-1 text-right font-mono text-amber-600 border-t-2 border-gray-400">${totalExisting}</td>
              <td class="py-1 text-right font-mono border-t-2 border-gray-400">${formatCurrencyFull(r.totalCost)}</td>
            </tr></tfoot>
          </table>
        </div>
        ${totalExisting > 0 ? `<div class="text-[10px] text-amber-600 mt-1">⚠ ${totalExisting} units already held in these price brackets. Overlap cost ~${formatCurrencyFull(overlapCost)}.</div>` : ''}
      </div>
    `
  }

  function renderGranBtns() {
    return [1,2,3,4,5].map(g =>
      `<button class="flex-1 text-xs py-1.5 rounded-lg font-medium gran-btn ${g === params.granularity ? 'bg-primary text-white' : 'bg-gray-100'}" data-val="${g}">${g}</button>`
    ).join('')
  }
  function updatePreview() {
    const granEl = document.getElementById('gran-btns')
    if (granEl) granEl.innerHTML = renderGranBtns()
    const previewEl = document.getElementById('strategy-preview')
    if (previewEl) previewEl.innerHTML = renderPreview()
  }

  const content = `
    <div class="space-y-3 text-sm strategy-creator">
      <div>
        <label class="input-label">Strategy Type</label>
        <select class="input" id="strategy-type">
          <option value="1234" selected>1234 Strategy</option>
        </select>
      </div>
      <div>
        <label class="input-label">Label</label>
        <input class="input" id="strategy-label" value="${escHtml(label)}" />
      </div>
      <div>
        <label class="input-label">Max Buy Price (MBP)</label>
        <input type="number" step="0.01" class="input" id="strategy-mbp" value="${params.MBP}" />
      </div>
      <div>
        <label class="input-label">Buy-back Ratio <span id="buyback-val" class="text-primary">${Math.round(params.buybackRatio * 100)}%</span></label>
        <input type="range" min="0" max="1" step="0.01" class="w-full" id="strategy-buyback" value="${params.buybackRatio}" />
        <div class="flex gap-2 mt-1">
          <button class="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 quick-ratio" data-val="0.5">50%</button>
          <button class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 font-medium quick-ratio" data-val="0.666">66.6%</button>
        </div>
      </div>
      <div>
        <label class="input-label">Target Avg Factor <span id="avgf-val" class="text-primary">${params.targetAvgFactor.toFixed(2)}</span></label>
        <input type="range" min="0.5" max="1" step="0.01" class="w-full" id="strategy-avgf" value="${params.targetAvgFactor}" />
      </div>
      <div>
        <label class="input-label">Granularity <span id="gran-val" class="text-primary">Level ${params.granularity}</span></label>
        <div class="flex gap-1" id="gran-btns">
          ${renderGranBtns()}
        </div>
      </div>
      <div id="strategy-preview">${renderPreview()}</div>
    </div>
  `

  const modalPromise = showModal({
    title: 'Create Strategy — ' + escHtml(stock.symbol),
    content,
    confirmText: 'Save Strategy',
    onMounted: () => {
      document.getElementById('strategy-type')?.addEventListener('change', function () {
        params.type = this.value; updatePreview()
      })
      document.getElementById('strategy-label')?.addEventListener('input', function () {
        label = this.value
      })
      document.getElementById('strategy-mbp')?.addEventListener('input', function () {
        params.MBP = parseFloat(this.value) || 0; updatePreview()
      })
      document.getElementById('strategy-buyback')?.addEventListener('input', function () {
        params.buybackRatio = parseFloat(this.value)
        document.getElementById('buyback-val').textContent = Math.round(params.buybackRatio * 100) + '%'
        updatePreview()
      })
      document.getElementById('strategy-avgf')?.addEventListener('input', function () {
        params.targetAvgFactor = parseFloat(this.value)
        document.getElementById('avgf-val').textContent = params.targetAvgFactor.toFixed(2)
        updatePreview()
      })
      document.querySelectorAll('.quick-ratio').forEach(btn => {
        btn.addEventListener('click', function () {
          params.buybackRatio = parseFloat(this.dataset.val)
          document.getElementById('strategy-buyback').value = params.buybackRatio
          document.getElementById('buyback-val').textContent = Math.round(params.buybackRatio * 100) + '%'
          updatePreview()
        })
      })
      document.getElementById('gran-btns').addEventListener('click', function (e) {
        const btn = e.target.closest('.gran-btn')
        if (!btn) return
        params.granularity = parseInt(btn.dataset.val)
        document.getElementById('gran-val').textContent = 'Level ' + params.granularity
        updatePreview()
      })
    },
    onConfirm: () => {
      const lbl = (document.getElementById('strategy-label')?.value || '').trim()
      if (!lbl) { showToast('Please enter a label'); return false }
      if (params.MBP <= 0) { showToast('Please enter a valid Max Buy Price'); return false }
      if (params.MBP <= params.ASP * params.targetAvgFactor) { showToast('MBP must be greater than target avg price'); return false }
      return { label: lbl, params: { ...params } }
    },
  })

  const result = await modalPromise
  if (!result) return

  const r2 = calc1234Lots(result.params)
  const existing = computeExistingHoldings(r2.lots, activeEntries)
  await saveStrategy({
    stockId,
    label: result.label,
    type: result.params.type,
    params: result.params,
    lots: existing,
    totalQty: r2.totalQty,
    totalCost: r2.totalCost,
    avgPrice: r2.avgPrice,
    SQ,
    ASP,
    status: 'active',
  })
  showToast('Strategy saved')
  renderStockList()
}

async function showStrategyDetail(strategyId) {
  const strategy = await getStrategy(strategyId)
  if (!strategy) return
  const stock = allStocks.find(s => s._id === strategy.stockId)
  const allStrategies = stock ? await getStrategies(stock._id) : []
  const otherStrats = allStrategies.filter(s => s._id !== strategyId)
  let currentIdx = 0
  const strats = [strategy, ...otherStrats]

  function renderContent(s) {
    const totalQty = (s.lots || []).reduce((a, l) => a + l.qty, 0)
    const avgPrice = totalQty > 0 ? (s.lots || []).reduce((a, l) => a + l.qty * l.price, 0) / totalQty : 0
    return { totalQty, avgPrice }
  }

  async function loadContent(s) {
    const allEntries = s.stockId ? await getStockEntries(s.stockId) : []
    const activeEntries = allEntries.filter(e => e.remainingQty > 0)
    const totalExisting = activeEntries.reduce((a, e) => a + e.remainingQty, 0)
    const lotsWithExisting = computeExistingHoldings(s.lots || [], activeEntries)
    const { totalQty, avgPrice } = renderContent(s)
    const navHtml = strats.length > 1 ? `
      <div class="flex items-center justify-between mb-2 gap-2">
        <button class="btn-icon btn-ghost text-base${currentIdx === 0 ? ' opacity-20 pointer-events-none' : ''}" id="strat-prev"><ion-icon name="chevron-back-outline"></ion-icon></button>
        <span class="text-[10px] text-gray-400">${currentIdx + 1} of ${strats.length}</span>
        <button class="btn-icon btn-ghost text-base${currentIdx === strats.length - 1 ? ' opacity-20 pointer-events-none' : ''}" id="strat-next"><ion-icon name="chevron-forward-outline"></ion-icon></button>
      </div>
    ` : ''

    const bodyHtml = `
      <div class="space-y-3 text-sm">
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Type</div>
            <div class="font-semibold">${s.type || '1234'}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Status</div>
            <div class="font-semibold text-green-600">${s.status}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Total Qty</div>
            <div class="font-semibold">${totalQty}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Total Investment</div>
            <div class="font-semibold font-mono">${formatCurrencyFull(s.totalCost)}</div>
          </div>
          <div class="bg-gray-50 rounded-lg p-2">
            <div class="text-gray-400">Target Avg</div>
            <div class="font-semibold font-mono text-indigo-600">${s.avgPrice.toFixed(1)}</div>
          </div>
        </div>
        <div id="strategy-range-summary" class="hidden"></div>
        <div class="overflow-x-auto max-h-64 overflow-y-auto">
          <table class="w-full text-xs">
            <thead><tr class="text-gray-400 border-b border-gray-100">
              <th class="text-left py-1 pr-1">Qty</th>
              <th class="text-right py-1 pr-1">Price</th>
              <th class="text-right py-1">Existing</th>
            </tr></thead>
            <tbody>${lotsWithExisting.map((l, i) => `
              <tr class="strategy-lot-row border-b border-gray-50 cursor-pointer" data-index="${i}">
                <td class="py-1 pr-1">${l.qty}</td>
                <td class="py-1 pr-1 text-right font-mono">${l.price.toFixed(1)}</td>
                <td class="py-1 text-right font-mono ${l.existing > 0 ? 'text-amber-600 font-semibold' : ''}">${l.existing}</td>
              </tr>
            `).join('')}</tbody>
            <tfoot><tr class="font-medium">
              <td class="py-1 pr-1 border-t-2 border-gray-400">${totalQty}</td>
              <td class="py-1 pr-1 text-right font-mono border-t-2 border-gray-400">${avgPrice.toFixed(1)}</td>
              <td class="py-1 text-right font-mono border-t-2 border-gray-400${totalExisting > 0 ? ' text-amber-600' : ''}">${totalExisting}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    `

    const body = document.querySelector('.modal-body')
    if (!body) return
    body.innerHTML = navHtml + bodyHtml

    document.getElementById('detail-print-strategy')?.addEventListener('click', () => printStrategy(s, stock, lotsWithExisting, totalQty, avgPrice, totalExisting))

    document.getElementById('detail-delete-strategy')?.addEventListener('click', async () => {
      const ok = await showConfirm({ title: 'Delete Strategy?', message: 'This cannot be undone.', confirmText: 'Delete', danger: true })
      if (ok) { await deleteStrategy(s._id); showToast('Strategy deleted'); renderStockList(); document.querySelector('#modal-container > div [data-dismiss]')?.click() }
    })

    const summary = document.getElementById('strategy-range-summary')
    document.querySelectorAll('.strategy-lot-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.index)
        const range = lotsWithExisting.slice(0, idx + 1)
        const rQty = range.reduce((a, l) => a + l.qty, 0)
        const rCost = range.reduce((a, l) => a + l.qty * l.price, 0)
        const rAvg = rQty > 0 ? rCost / rQty : 0
        const rExist = range.reduce((a, l) => a + l.existing, 0)
        const rExistAvg = rExist > 0 ? range.reduce((a, l) => a + l.existing * (l.existingAvgPrice || l.price), 0) / rExist : 0
        document.querySelectorAll('.strategy-lot-row').forEach(r => r.classList.remove('bg-blue-100'))
        document.querySelectorAll('.strategy-lot-row').forEach(r => {
          if (parseInt(r.dataset.index) <= idx) r.classList.add('bg-blue-100')
        })
        if (!summary) return
        summary.className = 'bg-blue-50 rounded-lg p-2 text-xs mb-2 cursor-pointer'
        summary.innerHTML = `
          <div class="text-[10px] text-blue-600 font-medium mb-1">Rows 1–${idx + 1}</div>
          <div class="grid grid-cols-5 gap-1 text-[11px]">
            <div><span class="text-gray-400">Qty</span><br><span class="font-semibold">${rQty}</span></div>
            <div><span class="text-gray-400">SAP</span><br><span class="font-semibold font-mono">${rAvg.toFixed(1)}</span></div>
            <div><span class="text-gray-400">Total</span><br><span class="font-semibold font-mono">${formatCurrencyFull(rCost)}</span></div>
            <div><span class="text-gray-400">ExQ</span><br><span class="font-semibold font-mono ${rExist > 0 ? 'text-amber-600' : ''}">${rExist}</span></div>
            <div><span class="text-gray-400">ExAP</span><br><span class="font-semibold font-mono">${rExistAvg.toFixed(1)}</span></div>
          </div>
        `
        summary.addEventListener('click', () => {
          document.querySelectorAll('.strategy-lot-row').forEach(r => r.classList.remove('bg-blue-100'))
          summary.classList.add('hidden')
        }, { once: true })
      })
    })

    document.getElementById('strat-prev')?.addEventListener('click', () => {
      if (currentIdx > 0) { currentIdx--; loadContent(strats[currentIdx]) }
    })
    document.getElementById('strat-next')?.addEventListener('click', () => {
      if (currentIdx < strats.length - 1) { currentIdx++; loadContent(strats[currentIdx]) }
    })

    const touchArea = body.querySelector('.space-y-3')
    if (touchArea && strats.length > 1) {
      let sx = 0
      touchArea.addEventListener('touchstart', e => { sx = e.touches[0].clientX }, { passive: true })
      touchArea.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx
        if (Math.abs(dx) > 50) {
          if (dx < 0 && currentIdx < strats.length - 1) { currentIdx++; loadContent(strats[currentIdx]) }
          else if (dx > 0 && currentIdx > 0) { currentIdx--; loadContent(strats[currentIdx]) }
        }
      }, { passive: true })
    }
  }

  const mPromise = showModal({
    title: `<span class="inline-flex items-center gap-1"><button class="btn-icon btn-ghost text-base" id="detail-print-strategy" title="Print"><ion-icon name="print-outline"></ion-icon></button><span>${escHtml(stock ? stock.symbol : '')} — ${escHtml(strategy.label)}</span><button class="btn-icon btn-ghost text-base text-red-500 hover:bg-red-50" id="detail-delete-strategy" title="Delete Strategy"><ion-icon name="trash-outline"></ion-icon></button></span>`,
    content: '<div class="text-xs text-gray-400 text-center py-4">Loading...</div>',
    confirmText: 'Close',
    showCancel: false,
    onMounted: () => loadContent(strategy),
  })
  await mPromise
}

function printStrategy(strategy, stock, lotsWithExisting, totalQty, avgPrice, totalExisting) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<html><head><title>${escHtml(stock ? stock.symbol : '')} - ${escHtml(strategy.label)}</title>
<style>
body{font-family:sans-serif;padding:20px;font-size:12px}
h2{font-size:16px;margin:0 0 8px}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.metric{background:#f5f5f5;border-radius:6px;padding:8px;text-align:center}
.metric .lbl{color:#888;font-size:10px}
.metric .val{font-weight:600;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{text-align:left;color:#888;border-bottom:1px solid #eee;padding:4px 6px}
td{padding:4px 6px;border-bottom:1px solid #f5f5f5}
.text-right{text-align:right}
.font-mono{font-family:monospace}
.border-t-2{border-top:2px solid #999}
.font-medium{font-weight:500}
.amber{color:#d97706}
.footer-note{text-align:center;color:#aaa;font-size:9px;margin-top:16px}
</style></head><body>
<h2>${escHtml(stock ? stock.symbol : '')} — ${escHtml(strategy.label)}</h2>
<div class="metrics">
  <div class="metric"><div class="lbl">Type</div><div class="val">${strategy.type || '1234'}</div></div>
  <div class="metric"><div class="lbl">Status</div><div class="val" style="color:#16a34a">${strategy.status}</div></div>
  <div class="metric"><div class="lbl">Total Qty</div><div class="val">${totalQty}</div></div>
  <div class="metric"><div class="lbl">Total Investment</div><div class="val">${formatCurrencyFull(strategy.totalCost)}</div></div>
  <div class="metric"><div class="lbl">Target Avg</div><div class="val" style="color:#4f46e5">${strategy.avgPrice.toFixed(1)}</div></div>
</div>
<table>
<thead><tr><th>Qty</th><th class="text-right">Price</th><th class="text-right">Existing</th></tr></thead>
<tbody>${lotsWithExisting.map(l => `
  <tr><td>${l.qty}</td><td class="text-right font-mono">${l.price.toFixed(1)}</td><td class="text-right font-mono${l.existing > 0 ? ' amber' : ''}">${l.existing}</td></tr>
`).join('')}</tbody>
<tfoot><tr style="font-weight:500"><td class="border-t-2">${totalQty}</td><td class="text-right font-mono border-t-2">${avgPrice.toFixed(1)}</td><td class="text-right font-mono border-t-2${totalExisting > 0 ? ' amber' : ''}">${totalExisting}</td></tr></tfoot>
</table>
<div class="footer-note">Generated by Lending Accountant</div>
<script>window.print()</script>
</body></html>`)
  w.document.close()
}

async function showStockDetail(stockId) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return

  const entries = await getStockEntries(stockId)
  const activeEntries = entries.filter(e => e.remainingQty > 0)
  const partners = [...new Set(entries.map(e => e.partnerName).filter(Boolean))]
  let selectedPartner = ''
  let stockTab = 'holding'
  let selectionMode = false
  let selectedEntryIds = new Set()

  function renderDetailContent(partner, tab) {
    const filtered = partner ? entries.filter(e => e.partnerName === partner) : entries
    const holding = filtered.filter(e => e.remainingQty > 0)
    const sold = filtered.filter(e => !e.remainingQty || e.remainingQty <= 0)
    const totalQty = calcTotalQty(holding)
    const avgPrice = calcAvgBuyPrice(holding)
    const avgDays = calcAvgDays(holding)
    const avgValue = calcAggregatedCurrentValue(holding)

    const soldTotalQty = sold.reduce((s, e) => s + e.qty, 0)
    const soldTotalProfit = sold.reduce((sum, e) => sum + (e.soldPrice ? (e.soldPrice - e.price) * e.qty : 0), 0)
    const soldAvgBuy = soldTotalQty > 0 ? sold.reduce((sum, e) => sum + e.price * e.qty, 0) / soldTotalQty : 0
    const soldAvgSell = soldTotalQty > 0 && sold.every(e => e.soldPrice) ? sold.reduce((sum, e) => sum + e.soldPrice * e.qty, 0) / soldTotalQty : 0

    const editBtn = `<div class="flex justify-end mb-1">
  <button class="stock-edit text-primary flex items-center gap-1 text-xs" data-id="${stock._id}">
    <ion-icon name="create-outline" class="text-sm"></ion-icon>
    <span>Edit</span>
  </button>
</div>`

    const partnerTabs = partners.length > 0 ? `
      <div class="flex gap-1 overflow-x-auto pb-1 mb-2">
        <button class="partner-tab text-xs px-2.5 py-1 rounded-full font-medium ${!partner ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}" data-partner="">All</button>
        ${partners.map(p => `
          <button class="partner-tab text-xs px-2.5 py-1 rounded-full font-medium ${partner === p ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}" data-partner="${escHtml(p)}">${escHtml(p)}</button>
        `).join('')}
      </div>
    ` : ''

    const viewTabs = `
      <div class="flex gap-2 mb-2">
        <button class="view-tab text-xs px-3 py-1 rounded-full font-medium ${tab === 'holding' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}" data-view="holding">Holding</button>
        <button class="view-tab text-xs px-3 py-1 rounded-full font-medium ${tab === 'sold' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}" data-view="sold">Sold</button>
        <button class="view-tab text-xs px-3 py-1 rounded-full font-medium ${tab === 'strategy' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}" data-view="strategy">Strategy</button>
      </div>
    `

    const holdingTable = holding.length > 0 ? `
      <div class="mt-2">
        <div id="selection-summary" class="hidden flex items-center px-3 py-2 rounded-lg bg-yellow-100 border border-yellow-300 text-xs mb-2 cursor-pointer select-none" title="Double-click to clear selection">
          <div class="flex items-center gap-3">
            <span class="text-gray-600">Qty: <span id="sel-qty" class="font-semibold">0</span></span>
            <span class="text-gray-300">|</span>
            <span class="text-gray-600">Price: <span id="sel-price" class="font-semibold">-</span></span>
            <span class="text-gray-300">|</span>
            <span class="text-gray-600">Val: <span id="sel-value" class="font-semibold">-</span></span>
            <span class="text-gray-300">|</span>
            <span class="text-gray-600">ROI: <span id="sel-roi" class="font-semibold">-</span></span>
            <span class="text-gray-300">|</span>
            <span class="text-gray-600">P&amp;L: <span id="sel-pnl" class="font-semibold">-</span></span>
          </div>
        </div>
        <table class="w-full text-xs">
          <thead><tr class="text-gray-400 border-b border-gray-100">
            <th class="text-left py-1 pr-1">Qty</th>
            <th class="text-left py-1 pr-1">Price</th>
            <th class="text-left py-1 pr-1">Date</th>
            <th class="text-left py-1 pr-1">Days</th>
            <th class="text-right py-1">Value</th>
          </tr></thead>
            <tbody>${holding.map(e => {
            const days = calcDaysHeld(e.date)
            const cv = calcCurrentValue(e.price, e.monthlyRate, e.minReturn, days)
            const v1 = calcV1(e.price, e.minReturn)
            const v2 = calcV2(e.price, e.monthlyRate, days)
            const riskColor = v2 > v1 ? 'text-red-500' : ''
            const isSelected = selectedEntryIds.has(e._id)
            return `
              <tr class="holding-row border-b border-gray-50 ${selectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'bg-yellow-100' : ''}" data-entry-id="${e._id}" style="user-select:none">
                <td class="py-1.5 pr-1">${e.remainingQty}</td>
                <td class="py-1.5 pr-1">${'₹' + Number(e.price).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                <td class="py-1.5 pr-1">${formatDate(e.date)}</td>
                <td class="py-1.5 pr-1">${days}d</td>
                <td class="py-1.5 text-right font-mono ${riskColor}">${(cv < 0 ? '-' : '') + '₹' + Math.abs(cv).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
              </tr>
              <tr class="border-b border-gray-100 text-[10px] text-gray-400">
                <td class="pb-1.5 pt-0.5" colspan="5">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-gray-500">${escHtml(e.partnerName)}</span>
                      <span>R: ${e.monthlyRate}%</span>
                      <span>M: ${e.minReturn}%</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <button class="text-primary entry-edit flex items-center" data-id="${e._id}">
                        <ion-icon name="create-outline" class="text-sm"></ion-icon>
                      </button>
                      <button class="text-red-500 entry-delete flex items-center" data-id="${e._id}">
                        <ion-icon name="trash-outline" class="text-sm"></ion-icon>
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            `
          }).join('')}</tbody>
        </table>
      </div>
    ` : '<p class="text-xs text-gray-400 mt-2">No holdings</p>'

    const soldTable = sold.length > 0 ? `
      <div class="grid grid-cols-2 gap-2 text-xs mb-2 mt-2 ${soldTotalQty === 0 ? 'text-gray-400' : ''}">
        <div><span class="text-gray-400">Qty</span><br><span class="font-semibold">${soldTotalQty}</span></div>
        <div><span class="text-gray-400">P&amp;L</span><br><span class="font-semibold ${soldTotalProfit >= 0 ? 'text-green-600' : 'text-red-600'}">${soldTotalQty > 0 ? formatCurrencyFull(soldTotalProfit) : '-'}</span></div>
        <div><span class="text-gray-400">Avg Buy</span><br><span class="font-semibold">${soldAvgBuy > 0 ? formatCurrencyFull(soldAvgBuy) : '-'}</span></div>
        <div><span class="text-gray-400">Avg Sell</span><br><span class="font-semibold">${soldAvgSell > 0 ? formatCurrencyFull(soldAvgSell) : '-'}</span></div>
      </div>
      <div>
        <table class="w-full text-xs">
          <thead><tr class="text-gray-400 border-b border-gray-100">
            <th class="text-left py-1 pr-1">Qty</th>
            <th class="text-left py-1 pr-1">BP</th>
            <th class="text-left py-1 pr-1">BD</th>
            <th class="text-right py-1 pr-1">SP</th>
            <th class="text-right py-1 pr-1">SD</th>
            <th class="text-right py-1">P&L</th>
          </tr></thead>
          <tbody>${[...sold].sort((a, b) => new Date(b.soldDate || b.date) - new Date(a.soldDate || a.date)).map(e => {
            const profit = e.soldPrice ? (e.soldPrice - e.price) * e.qty : 0
            return `
            <tr class="border-b border-gray-50">
              <td class="py-1.5 pr-1">${e.qty}</td>
              <td class="py-1.5 pr-1">${formatCurrencyFull(e.price)}</td>
              <td class="py-1.5 pr-1">${formatDate(e.date)}</td>
              <td class="py-1.5 pr-1 text-right">${e.soldPrice ? formatCurrencyFull(e.soldPrice) : '-'}</td>
              <td class="py-1.5 pr-1 text-right">${e.soldDate ? formatDate(e.soldDate) : '-'}</td>
              <td class="py-1.5 text-right font-mono ${profit >= 0 ? 'text-green-600' : 'text-red-600'}">${e.soldPrice ? formatCurrencyFull(profit) : '-'}</td>
            </tr>
            <tr class="border-b border-gray-100 text-[10px] text-gray-400">
              <td class="pb-1.5 pt-0.5" colspan="6">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-gray-500">${escHtml(e.partnerName)}</span>
                    <span>R: ${e.monthlyRate}%</span>
                    <span>M: ${e.minReturn}%</span>
                    ${e.soldPrice ? `<span class="${e.soldPrice > e.price ? 'text-green-500' : 'text-red-500'}">ROI: ${((e.soldPrice - e.price) / e.price * 100).toFixed(1)}%</span>` : ''}
                  </div>
                  <div class="flex items-center gap-2">
                    <button class="text-primary sold-entry-edit flex items-center" data-id="${e._id}">
                      <ion-icon name="create-outline" class="text-sm"></ion-icon>
                    </button>
                    <button class="text-red-500 sold-entry-delete flex items-center" data-id="${e._id}">
                      <ion-icon name="trash-outline" class="text-sm"></ion-icon>
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          `}).join('')}</tbody>
        </table>
      </div>
    ` : '<p class="text-xs text-gray-400 mt-2">No sold entries</p>'

    return `
      ${editBtn}
      ${partnerTabs}
      ${viewTabs}
      ${tab === 'holding' ? `
        <div class="grid grid-cols-2 gap-2 text-xs ${totalQty === 0 ? 'text-gray-400' : ''}">
          <div><span class="text-gray-400">Qty</span><br><span class="font-semibold">${totalQty}</span></div>
          <div><span class="text-gray-400">Days</span><br><span class="font-semibold">${avgDays > 0 ? Math.round(avgDays) : '-'}</span></div>
          <div><span class="text-gray-400">Price</span><br><span class="font-semibold">${avgPrice > 0 ? (avgPrice < 0 ? '-₹' : '₹') + Math.abs(avgPrice).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</span></div>
          <div><span class="text-gray-400">Value</span><br><span class="font-semibold">${avgValue > 0 ? (avgValue < 0 ? '-₹' : '₹') + Math.abs(avgValue).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</span></div>
        </div>
        ${holding.length > 0 ? `
          <div class="flex gap-2 mt-2">
            <button class="btn-primary text-xs flex-1 py-1.5" id="detail-buy">Buy</button>
            <button class="btn-danger text-xs flex-1 py-1.5" id="detail-sell">Sell</button>
          </div>
        ` : ''}
        ${holdingTable}
      ` : tab === 'strategy' ? `<div id="detail-strategy-content"><p class="text-xs text-gray-400 py-2">Loading strategies...</p></div>` : soldTable}
    `
  }

  function bindDetailActions() {
    const stockId = stock._id
    document.querySelectorAll('.partner-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        clearSelection()
        selectedPartner = tab.dataset.partner
        const body = document.querySelector('.modal-body')
        if (body) body.innerHTML = renderDetailContent(selectedPartner, stockTab)
        bindDetailActions()
      })
    })
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        clearSelection()
        stockTab = tab.dataset.view
        const body = document.querySelector('.modal-body')
        if (body) body.innerHTML = renderDetailContent(selectedPartner, stockTab)
        bindDetailActions()
        if (stockTab === 'strategy') {
          const c = document.getElementById('detail-strategy-content')
          if (c) {
            const strats = await getStrategies(stockId)
            if (strats.length === 0) {
              c.innerHTML = `<div class="text-center py-4"><p class="text-xs text-gray-400 mb-2">No strategies yet</p><button class="btn-primary text-xs py-1.5 px-3" id="detail-create-strategy">Create Strategy</button></div>`
            } else {
              c.innerHTML = `<div class="space-y-2">${strats.map(s => `
                <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 detail-strat-link" data-id="${s._id}">
                  <div>
                    <div class="text-sm font-medium">${escHtml(s.label)}</div>
                    <div class="text-[10px] text-gray-400">${Object.keys(s.filledLots || {}).length}/${(s.lots || []).length} lots · ${formatCurrencyFull(s.totalCost)}</div>
                  </div>
                  <ion-icon name="chevron-forward-outline" class="text-gray-300"></ion-icon>
                </div>`).join('')}
                <button class="btn-primary text-xs py-1.5 px-3 w-full mt-1" id="detail-create-strategy">+ New Strategy</button>
              </div>`
            }
            document.getElementById('detail-create-strategy')?.addEventListener('click', () => showCreateStrategy(stockId))
            document.querySelectorAll('.detail-strat-link').forEach(el => {
              el.addEventListener('click', () => showStrategyDetail(el.dataset.id))
            })
          }
        }
      })
    })
    document.querySelectorAll('.stock-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        await showEditStockForm(btn.dataset.id)
        document.getElementById('modal-container').innerHTML = ''
        showStockDetail(btn.dataset.id)
      })
    })
    document.querySelectorAll('.entry-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = await getStockEntry(btn.dataset.id)
      if (entry) {
        const done = await showBuyForm(stockId, entry)
        if (done) {
          document.getElementById('modal-container').innerHTML = ''
          showStockDetail(stockId)
        }
      }
    })
    })
    document.querySelectorAll('.entry-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const entry = await getStockEntry(btn.dataset.id)
        if (entry && confirm('Delete this entry?')) {
          await deleteStockEntry(btn.dataset.id)
          logAction('delete', 'stock_entry', btn.dataset.id, `Deleted entry: ${stock.symbol} qty:${entry.qty}`)
          allStocks = await getAllStockSymbols()
          allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
          renderStockList()
          document.getElementById('modal-container').innerHTML = ''
          showStockDetail(stockId)
        }
      })
    })
    document.querySelectorAll('.sold-entry-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = await getStockEntry(btn.dataset.id)
      if (entry) {
        const done = await showSellEntryEditForm(stockId, entry)
        if (done) {
          document.getElementById('modal-container').innerHTML = ''
          showStockDetail(stockId)
        }
      }
    })
  })
  document.querySelectorAll('.sold-entry-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = await getStockEntry(btn.dataset.id)
      if (entry && confirm('Delete this sold entry?')) {
        await deleteStockEntry(btn.dataset.id)
        logAction('delete', 'stock_entry', btn.dataset.id, `Deleted sold entry: ${stock.symbol} qty:${entry.qty} sold @ ${entry.soldPrice}`)
        allStocks = await getAllStockSymbols()
        allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
        renderStockList()
        document.getElementById('modal-container').innerHTML = ''
        showStockDetail(stockId)
      }
    })
  })
  const buyBtn = document.getElementById('detail-buy')
  if (buyBtn) buyBtn.addEventListener('click', async () => {
    const done = await showBuyForm(stockId, null, selectedPartner)
    if (done) {
      document.getElementById('modal-container').innerHTML = ''
      showStockDetail(stockId)
    }
  })
  const sellBtn = document.getElementById('detail-sell')
  if (sellBtn) sellBtn.addEventListener('click', async () => {
    const done = await showSellForm(stockId, selectedPartner)
    if (done) {
      document.getElementById('modal-container').innerHTML = ''
      showStockDetail(stockId)
    }
  })

  function updateSelectionSummary() {
    const holding = activeEntries.filter(e => selectedEntryIds.has(e._id))
    const totalQty = holding.reduce((s, e) => s + e.remainingQty, 0)
    const avgPrice = totalQty > 0 ? holding.reduce((s, e) => s + e.remainingQty * e.price, 0) / totalQty : 0
    const totalValue = holding.reduce((s, e) => s + e.remainingQty * calcCurrentValue(e.price, e.monthlyRate, e.minReturn, calcDaysHeld(e.date)), 0)
    const avgValue = totalQty > 0 ? totalValue / totalQty : 0
    const roi = avgPrice > 0 ? (avgValue - avgPrice) / avgPrice * 100 : 0
    const totalPnl = holding.reduce((s, e) => s + e.remainingQty * (calcCurrentValue(e.price, e.monthlyRate, e.minReturn, calcDaysHeld(e.date)) - e.price), 0)
    const summary = document.getElementById('selection-summary')
    if (!summary) return
    if (selectedEntryIds.size === 0) {
      summary.classList.add('hidden')
      return
    }
    summary.classList.remove('hidden')
    document.getElementById('sel-qty').textContent = totalQty
    document.getElementById('sel-price').textContent = (avgPrice < 0 ? '-₹' : '₹') + Math.abs(avgPrice).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    document.getElementById('sel-value').textContent = (avgValue < 0 ? '-₹' : '₹') + Math.abs(avgValue).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    document.getElementById('sel-roi').textContent = (roi >= 0 ? '+' : '') + roi.toFixed(1) + '%'
    document.getElementById('sel-roi').className = 'font-semibold ' + (roi >= 0 ? 'text-green-600' : 'text-red-600')
    document.getElementById('sel-pnl').textContent = formatCurrencyFull(totalPnl)
    document.getElementById('sel-pnl').className = 'font-semibold ' + (totalPnl >= 0 ? 'text-green-600' : 'text-red-600')
    document.querySelectorAll('.holding-row').forEach(row => {
      const id = row.dataset.entryId
      row.classList.toggle('bg-yellow-100', selectedEntryIds.has(id))
    })
  }

  function clearSelection() {
    selectionMode = false
    selectedEntryIds.clear()
    const summary = document.getElementById('selection-summary')
    if (summary) summary.classList.add('hidden')
    document.querySelectorAll('.holding-row').forEach(row => row.classList.remove('bg-yellow-100'))
  }

  let holdTimer = null
  function startHold(e, rowId) {
    if (selectionMode) return
    e.preventDefault()
    holdTimer = setTimeout(() => {
      selectionMode = true
      selectedEntryIds.add(rowId)
      updateSelectionSummary()
    }, 500)
  }
  function clearHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null } }
  document.querySelectorAll('.holding-row').forEach(row => {
    const rowId = row.dataset.entryId
    row.addEventListener('mousedown', e => startHold(e, rowId))
    row.addEventListener('mouseup', clearHold)
    row.addEventListener('mouseleave', clearHold)
    row.addEventListener('touchstart', e => startHold(e, rowId), { passive: false })
    row.addEventListener('touchend', clearHold)
    row.addEventListener('touchcancel', clearHold)
    row.addEventListener('selectstart', e => e.preventDefault())
    row.addEventListener('contextmenu', e => e.preventDefault())
    row.addEventListener('click', (e) => {
      clearHold()
      if (!selectionMode) return
      if (selectedEntryIds.has(rowId)) {
        selectedEntryIds.delete(rowId)
        if (selectedEntryIds.size === 0) { clearSelection(); return }
      } else {
        selectedEntryIds.add(rowId)
      }
      updateSelectionSummary()
    })
  })

  let dclickTimer = null
  document.querySelector('.modal-body')?.addEventListener('click', (e) => {
    if (!e.target.closest('#selection-summary')) return
    if (dclickTimer) { clearTimeout(dclickTimer); dclickTimer = null; clearSelection(); return }
    dclickTimer = setTimeout(() => { dclickTimer = null }, 300)
  })
}

  const result = await showModal({
    title: escHtml(stock.symbol),
    content: renderDetailContent(selectedPartner, stockTab),
    confirmText: 'Close',
    showCancel: false,
    onMounted: () => {
      bindDetailActions()
    },
  })
}

async function showEditStockForm(stockId) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return false

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Stock Symbol</label>
        <input class="input uppercase bg-gray-50 text-gray-500" id="esf-symbol" value="${escHtml(stock.symbol)}" readonly disabled />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Monthly Return <span class="text-[10px] text-gray-400">(R)</span> *</label>
          <input class="input" id="esf-r" type="number" step="0.1" value="${stock.monthlyRate}" />
        </div>
        <div>
          <label class="input-label">Min Return <span class="text-[10px] text-gray-400">(M)</span> *</label>
          <input class="input" id="esf-m" type="number" step="0.1" value="${stock.minReturn}" />
        </div>
      </div>
      <div>
        <label class="input-label">Status</label>
        <select class="input" id="esf-status">
          <option value="active" ${stock.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${stock.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      </div>
    </div>
  `

  const result = await showModal({
    title: `Edit ${escHtml(stock.symbol)}`,
    content,
    confirmText: 'Update',
    onConfirm: () => {
      const r = parseFloat(document.getElementById('esf-r')?.value)
      const m = parseFloat(document.getElementById('esf-m')?.value)
      const status = document.getElementById('esf-status')?.value || 'active'
      if (!r || r <= 0) { showToast('Monthly return is required', 'error'); return false }
      if (!m || m <= 0) { showToast('Min return is required', 'error'); return false }
      return { monthlyRate: r, minReturn: m, status }
    },
  })

  if (!result || result === true) return false

  stock.monthlyRate = result.monthlyRate
  stock.minReturn = result.minReturn
  stock.status = result.status
  stock.updatedAt = new Date().toISOString()
  await saveStockSymbol(stock)
  logAction('update', 'stock', stock._id, `Updated stock: ${stock.symbol} (R:${result.monthlyRate}, M:${result.minReturn}, status:${result.status})`)
  showToast('Stock updated')

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
  return true
}

async function showSellEntryEditForm(stockId, editEntry) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return false

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Quantity *</label>
        <input class="input" id="sef-qty" type="number" step="1" value="${editEntry.qty}" />
      </div>
      <div>
        <label class="input-label">Sold Price *</label>
        <input class="input" id="sef-price" type="number" step="0.01" value="${editEntry.soldPrice || ''}" />
      </div>
      <div>
        <label class="input-label">Sold Date *</label>
        ${dateInputHTML({id: 'sef-date', value: editEntry.soldDate || new Date().toISOString().split('T')[0]})}
      </div>
    </div>
  `

  const result = await showModal({
    title: `Edit Sold Entry - ${stock.symbol}`,
    content,
    confirmText: 'Update',
    onMounted: () => setupDateInput('sef-date'),
    onConfirm: () => {
      const qty = parseInt(document.getElementById('sef-qty')?.value)
      const price = parseFloat(document.getElementById('sef-price')?.value)
      const date = getDateInputValue('sef-date')
      if (!qty || qty <= 0) { showToast('Valid quantity required', 'error'); return false }
      if (!price || price <= 0) { showToast('Valid sold price required', 'error'); return false }
      if (!date) { showToast('Select a date', 'error'); return false }
      return { qty, price, date }
    },
  })

  if (!result || result === true) return false

  editEntry.qty = result.qty
  editEntry.soldPrice = result.price
  editEntry.soldDate = result.date
  editEntry.updatedAt = new Date().toISOString()
  await saveStockEntry(editEntry)
  logAction('update', 'stock_entry', editEntry._id, `Updated sold entry: ${stock.symbol} qty:${result.qty} sold @ ${result.price} on ${result.date}`)
  showToast('Sold entry updated')

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
  return true
}

async function showBuyForm(stockId, editEntry, preselectedPartner) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return

  const partnerRadios = allPartners.filter(p => selectedPartners.has(p.name)).map(p => `
    <label class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${(editEntry?.partnerName === p.name || preselectedPartner === p.name) ? 'bg-primary/10 ring-1 ring-primary' : 'bg-gray-50 hover:bg-gray-100'}">
      <input type="radio" name="bf-partner" value="${escHtml(p.name)}" class="text-primary focus:ring-primary" ${(editEntry?.partnerName === p.name || (!editEntry && !preselectedPartner && preselectedPartner !== '')) ? 'checked' : ''} />
      <span class="text-sm">${escHtml(p.name)}</span>
    </label>
  `).join('')

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label mb-2">Partner *</label>
        <div class="flex flex-wrap gap-1.5">${partnerRadios}</div>
      </div>
      <div>
        <label class="input-label">Quantity *</label>
        <input class="input" id="bf-qty" type="number" step="1" value="${editEntry?.remainingQty || ''}" />
      </div>
      <div>
        <label class="input-label">Price per Unit *</label>
        <input class="input" id="bf-price" type="number" step="0.01" value="${editEntry?.price || ''}" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        ${dateInputHTML({id: 'bf-date', value: editEntry?.date || new Date().toISOString().split('T')[0]})}
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Monthly Return <span class="text-[10px] text-gray-400">(R)</span> *</label>
          <input class="input" id="bf-r" type="number" step="0.1" value="${editEntry?.monthlyRate ?? stock.monthlyRate}" />
        </div>
        <div>
          <label class="input-label">Min Return <span class="text-[10px] text-gray-400">(M)</span> *</label>
          <input class="input" id="bf-m" type="number" step="0.1" value="${editEntry?.minReturn ?? stock.minReturn}" />
        </div>
      </div>
    </div>
  `

  const result = await showModal({
    title: editEntry ? 'Edit Entry' : `Buy ${escHtml(stock.symbol)}`,
    content,
    confirmText: editEntry ? 'Update' : 'Buy',
    onMounted: () => setupDateInput('bf-date'),
    onConfirm: () => {
      const partner = document.querySelector('input[name="bf-partner"]:checked')?.value
      const qty = parseInt(document.getElementById('bf-qty')?.value)
      const price = parseFloat(document.getElementById('bf-price')?.value)
      const date = getDateInputValue('bf-date')
      const r = parseFloat(document.getElementById('bf-r')?.value)
      const m = parseFloat(document.getElementById('bf-m')?.value)
      if (!partner) { showToast('Select a partner', 'error'); return false }
      if (!qty || qty <= 0) { showToast('Valid quantity required', 'error'); return false }
      if (!price || price <= 0) { showToast('Valid price required', 'error'); return false }
      if (!date) { showToast('Select a date', 'error'); return false }
      if (!r || r <= 0) { showToast('Monthly return required', 'error'); return false }
      if (!m || m <= 0) { showToast('Min return required', 'error'); return false }
      return { partnerName: partner, qty, price, date, monthlyRate: r, minReturn: m }
    },
  })

  if (!result || result === true) return false

  if (editEntry) {
    editEntry.partnerName = result.partnerName
    editEntry.qty = result.qty
    editEntry.remainingQty = result.qty
    editEntry.price = result.price
    editEntry.date = result.date
    editEntry.monthlyRate = result.monthlyRate
    editEntry.minReturn = result.minReturn
    editEntry.updatedAt = new Date().toISOString()
    await saveStockEntry(editEntry)
    logAction('update', 'stock_entry', editEntry._id, `Updated entry: ${stock.symbol} qty:${result.qty} @ ${result.price}`)
    showToast('Entry updated')
  } else {
    await saveStockEntry({
      stockId,
      partnerName: result.partnerName,
      qty: result.qty,
      price: result.price,
      date: result.date,
      monthlyRate: result.monthlyRate,
      minReturn: result.minReturn,
      remainingQty: result.qty,
      status: 'holding',
    })
    logAction('create', 'stock_entry', '', `Bought ${stock.symbol} qty:${result.qty} @ ${result.price} for ${result.partnerName}`)
    showToast('Stock bought')
  }

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
  return true
}

async function showSellForm(stockId, preselectedPartner) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return

  const entries = await getStockEntries(stockId)
  const activeEntries = entries.filter(e => e.remainingQty > 0)
  if (activeEntries.length === 0) {
    showToast('No holdings to sell', 'error')
    return
  }

  const filteredPartners = allPartners.filter(p => selectedPartners.has(p.name))
  const partnerRadios = filteredPartners.map((p, i) => `
    <label class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${(preselectedPartner === p.name || (!preselectedPartner && i === 0)) ? 'bg-primary/10 ring-1 ring-primary' : 'bg-gray-50 hover:bg-gray-100'}">
      <input type="radio" name="sf-partner" value="${escHtml(p.name)}" class="text-primary focus:ring-primary" ${(preselectedPartner === p.name || (!preselectedPartner && i === 0)) ? 'checked' : ''} />
      <span class="text-sm">${escHtml(p.name)}</span>
    </label>
  `).join('')

  const totalQty = calcTotalQty(activeEntries)
  const avgPrice = calcAvgBuyPrice(activeEntries)

  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label mb-2">Partner</label>
        <div class="flex flex-wrap gap-1.5">
          ${partnerRadios}
        </div>
      </div>
      <div class="text-xs text-gray-400 space-y-1">
        <div>Available: ${totalQty} units @ avg ${formatCurrencyFull(avgPrice)}</div>
      </div>
      <div>
        <label class="input-label">Quantity *</label>
        <input class="input" id="sf-qty" type="number" step="1" placeholder="Max ${totalQty}" />
      </div>
      <div>
        <label class="input-label">Sell Price per Unit *</label>
        <input class="input" id="sf-price" type="number" step="0.01" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        ${dateInputHTML({id: 'sf-date', value: new Date().toISOString().split('T')[0]})}
      </div>
    </div>
  `

  const result = await showModal({
    title: `Sell ${escHtml(stock.symbol)}`,
    content,
    confirmText: 'Sell',
    danger: true,
    onMounted: () => setupDateInput('sf-date'),
    onConfirm: () => {
      const partner = document.querySelector('input[name="sf-partner"]:checked')?.value
      const qty = parseInt(document.getElementById('sf-qty')?.value)
      const price = parseFloat(document.getElementById('sf-price')?.value)
      const date = getDateInputValue('sf-date')
      if (!partner) { showToast('Select a partner', 'error'); return false }
      if (!qty || qty <= 0 || qty > totalQty) { showToast(`Quantity must be 1-${totalQty}`, 'error'); return false }
      if (!price || price <= 0) { showToast('Valid sell price required', 'error'); return false }
      if (!date) { showToast('Select a date', 'error'); return false }
      return { partnerName: partner, qty, price, date }
    },
  })

  if (!result || result === true) return false

  const sellEntries = activeEntries.filter(e => e.partnerName === result.partnerName)
  if (sellEntries.length === 0) { showToast('No holdings for selected partner', 'error'); return false }

  const sellTotalQty = calcTotalQty(sellEntries)
  if (result.qty > sellTotalQty) { showToast(`Only ${sellTotalQty} units available for selected partner`, 'error'); return false }

  const allocations = sellLIFO(sellEntries, result.qty)
  if (!allocations) {
    showToast('Not enough quantity available', 'error')
    return false
  }

  for (const { entry, take } of allocations) {
    const rem = Number(entry.remainingQty) || 0
    if (take >= rem) {
      entry.remainingQty = 0
      entry.status = 'sold'
      entry.soldPrice = result.price
      entry.soldDate = result.date
      entry.updatedAt = new Date().toISOString()
      await saveStockEntry(entry)
    } else {
      entry.remainingQty = rem - take
      entry.updatedAt = new Date().toISOString()
      await saveStockEntry(entry)
      await saveStockEntry({
        stockId: entry.stockId,
        partnerName: entry.partnerName,
        qty: take,
        price: entry.price,
        date: entry.date,
        monthlyRate: entry.monthlyRate,
        minReturn: entry.minReturn,
        remainingQty: 0,
        status: 'sold',
        soldPrice: result.price,
        soldDate: result.date,
        _lifoSplit: true,
      })
    }
  }

  logAction('update', 'stock_entry', '', `Sold ${result.qty} units of ${stock.symbol} @ ${result.price} (LIFO for ${result.partnerName})`)

  const gain = result.qty * (result.price - calcAvgBuyPrice(sellEntries))
  showToast(`Sold ${result.qty} units` + (gain >= 0 ? ` — gain: ${formatCurrencyFull(gain)}` : ''))

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
  return true
}
