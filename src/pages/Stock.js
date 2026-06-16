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

  function stockCardHtml(s) {
    const entries = entriesByStock[s._id] || []
    const activeEntries = entries.filter(e => e.remainingQty > 0)
    const totalQty = calcTotalQty(activeEntries)
    const avgPrice = calcAvgBuyPrice(activeEntries)
    const avgDays = calcAvgDays(activeEntries)
    const avgValue = calcAggregatedCurrentValue(activeEntries)
    return `
      <div class="card stock-card !p-3" data-id="${s._id}">
        <div class="flex items-center justify-between mb-1.5">
          <span class="font-bold text-sm">${escHtml(s.symbol)}</span>
          <div class="flex items-center gap-1.5">
            ${totalQty > 0 ? `
              <button class="w-7 h-7 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center stock-buy shadow-sm" data-id="${s._id}">B</button>
              <button class="w-7 h-7 rounded-lg bg-red-500 text-white text-xs font-bold flex items-center justify-center stock-sell shadow-sm" data-id="${s._id}">S</button>
            ` : `
              <button class="w-7 h-7 rounded-lg bg-primary text-white text-xs font-bold flex items-center justify-center stock-buy shadow-sm" data-id="${s._id}">B</button>
            `}
            <span class="text-[10px] px-1.5 py-0.5 rounded-full ${s.status === 'inactive' ? 'bg-gray-200 text-gray-500' : 'bg-green-100 text-green-700'}">${s.status === 'inactive' ? 'Ina' : 'Act'}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 text-[11px] ${totalQty === 0 ? 'text-gray-400' : ''}">
          <span><span class="text-gray-400">Q</span> <span class="font-semibold">${totalQty}</span></span>
          <span class="text-gray-200">|</span>
          <span><span class="text-gray-400">D</span> <span class="font-semibold">${avgDays > 0 ? Math.round(avgDays) : '-'}</span></span>
          <span class="text-gray-200">|</span>
          <span><span class="text-gray-400">P</span> <span class="font-semibold">${avgPrice > 0 ? formatCurrencyFull(avgPrice) : '-'}</span></span>
          <span class="text-gray-200">|</span>
          <span><span class="text-gray-400">V</span> <span class="font-semibold">${avgValue > 0 ? formatCurrencyFull(avgValue) : '-'}</span></span>
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
        if (e.target.closest('.stock-buy') || e.target.closest('.stock-sell')) return
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

function calcTargetProgress(entries, targetYear, targetMonth) {
  const now = new Date()
  const curYear = now.getFullYear().toString()
  const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')

  let yearPnL = 0
  let monthPnL = 0
  for (const e of entries) {
    if (!e.soldDate || e.status !== 'sold') continue
    const pnl = calcPnL(e)
    if (e.soldDate.startsWith(curYear)) yearPnL += pnl
    if (e.soldDate.startsWith(curMonth)) monthPnL += pnl
  }
  return { yearPnL, monthPnL }
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
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-primary text-white" data-tab="returns">Returns</button>
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600" data-tab="targets">Targets</button>
          <button class="analysis-tab text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600" data-tab="live">Live Prices</button>
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
    await renderReturnsTab()
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
      else if (tab === 'live') await renderLiveTab()
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
    let weightedSum = 0
    let totalWeight = 0
    let totalDays = 0
    for (const e of soldEntries) {
      const buy = new Date(e.date + 'T00:00:00')
      const sell = new Date((e.soldDate || e.date) + 'T00:00:00')
      const days = Math.max(1, (sell - buy) / 86400000)
      totalDays += days
      const cost = e.qty * e.price
      const pnl = calcPnL(e)
      if (cost > 0) {
        const tradeReturn = pnl / cost
        const ann = ((1 + tradeReturn) ** (365 / days) - 1) * 100
        weightedSum += ann * cost
        totalWeight += cost
      }
    }
    avgHoldingDays = totalDays / soldEntries.length
    if (totalWeight > 0) {
      annualizedReturn = (weightedSum / totalWeight).toFixed(1)
    }
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
      title: 'Annualized Return',
      body: 'The average per-year return across all closed trades, weighted by trade size.\n\nFormula (per trade):\n((1 + Trade P&L / Trade Cost) ^ (365 / Holding Days) − 1) × 100\n\nThen: value-weighted average of all trade-level annualized returns.\n(Larger trades contribute more to the final number.)\n\nThis is more accurate than using aggregate P&L with average days,\nbecause it doesn\'t let a few small quick trades distort the result.',
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
  let monthlyTarget = settings.stockMonthlyTarget || 0
  let yearlyTarget = settings.stockYearlyTarget || 0

  const allEntries = await getAllStockEntries()
  const { yearPnL, monthPnL } = calcTargetProgress(allEntries, yearlyTarget, monthlyTarget)
  const monthPct = monthlyTarget > 0 ? Math.min(100, (monthPnL / monthlyTarget * 100)).toFixed(0) : 0
  const yearPct = yearlyTarget > 0 ? Math.min(100, (yearPnL / yearlyTarget * 100)).toFixed(0) : 0

  content.innerHTML = `
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-gray-400 block mb-1">Monthly Target (₹)</label>
          <input class="input text-xs" id="target-monthly" type="number" step="1000" value="${monthlyTarget || ''}" placeholder="0" />
        </div>
        <div>
          <label class="text-xs text-gray-400 block mb-1">Yearly Target (₹)</label>
          <input class="input text-xs" id="target-yearly" type="number" step="10000" value="${yearlyTarget || ''}" placeholder="0" />
        </div>
      </div>
      <button class="btn-primary text-xs w-full py-1.5" id="save-targets-btn">Save Targets</button>

      ${(monthlyTarget > 0 || yearlyTarget > 0) ? `
      <hr class="border-gray-100">
      <div class="space-y-3">
        ${monthlyTarget > 0 ? `
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-500">This Month</span>
            <span class="font-mono font-semibold ${monthPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(monthPnL)} / ${formatCurrencyFull(monthlyTarget)}</span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ${monthPnL >= 0 ? 'bg-green-500' : 'bg-red-400'}" style="width:${monthPct}%"></div>
          </div>
          <div class="text-right text-[10px] text-gray-400 mt-0.5">${monthPct}% achieved</div>
        </div>
        ` : ''}
        ${yearlyTarget > 0 ? `
        <div>
          <div class="flex justify-between text-xs mb-1">
            <span class="text-gray-500">This Year</span>
            <span class="font-mono font-semibold ${yearPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(yearPnL)} / ${formatCurrencyFull(yearlyTarget)}</span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ${yearPnL >= 0 ? 'bg-indigo-500' : 'bg-red-400'}" style="width:${yearPct}%"></div>
          </div>
          <div class="text-right text-[10px] text-gray-400 mt-0.5">${yearPct}% achieved</div>
        </div>
        ` : ''}
      </div>
      ` : '<p class="text-xs text-gray-400 text-center py-3">Set targets above to track progress</p>'}
    </div>
  `

  document.getElementById('save-targets-btn').addEventListener('click', async () => {
    const m = parseFloat(document.getElementById('target-monthly')?.value) || 0
    const y = parseFloat(document.getElementById('target-yearly')?.value) || 0
    const s = await getSettings()
    s.stockMonthlyTarget = m
    s.stockYearlyTarget = y
    await saveSettings(s)
    showToast('Targets saved')
    await renderTargetsTab()
  })
}

async function renderLiveTab() {
  const content = document.getElementById('analysis-content')
  if (!content) return

  const allEntries = await getAllStockEntries()
  const activeEntries = allEntries.filter(e => e.remainingQty > 0)
  const activeSymbols = [...new Set(activeEntries.map(e => {
    const stock = allStocks.find(s => s._id === e.stockId)
    return stock ? stock.symbol : null
  }).filter(Boolean))]

    content.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-400">Last updated: <span id="live-update-time">—</span></span>
        <button class="btn-ghost text-xs px-2 py-1" id="refresh-live-btn"><ion-icon name="refresh-outline"></ion-icon> Refresh</button>
      </div>
      <div id="live-source-info" class="text-[9px] text-gray-400 hidden"></div>
      <div id="live-body" class="text-xs text-gray-400 text-center py-4">Fetching live prices...</div>
    </div>
  `

  async function loadLivePrices() {
    const body = document.getElementById('live-body')
    if (!body) return

    body.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">Fetching live prices...</div>'

    const priceMap = activeSymbols.length > 0 ? await fetchPrices(activeSymbols) : {}
    const updateTime = new Date().toLocaleTimeString()
    const updateEl = document.getElementById('live-update-time')
    if (updateEl) updateEl.textContent = updateTime

    const srcInfo = getLastSourceInfo()
    const srcEl = document.getElementById('live-source-info')
    if (srcEl) {
      if (srcInfo.source) {
        srcEl.textContent = `Source: ${srcInfo.source}`
        srcEl.className = 'text-[9px] text-green-600'
        srcEl.classList.remove('hidden')
      } else if (srcInfo.error) {
        srcEl.textContent = srcInfo.error
        srcEl.className = 'text-[9px] text-amber-600'
        srcEl.classList.remove('hidden')
      } else {
        srcEl.classList.add('hidden')
      }
    }

    const rows = []
    let totalCost = 0
    let totalMarketValue = 0
    let liveCount = 0

    for (const stock of allStocks) {
      const entries = activeEntries.filter(e => e.stockId === stock._id)
      if (entries.length === 0) continue
      const qty = entries.reduce((s, e) => s + e.remainingQty, 0)
      const avgPrice = entries.reduce((s, e) => s + e.remainingQty * e.price, 0) / qty
      const cost = qty * avgPrice
      totalCost += cost

      const ltp = priceMap[stock.symbol]
      if (ltp != null) {
        liveCount++
        const mktVal = qty * ltp
        totalMarketValue += mktVal
        const pnl = mktVal - cost
        const pnlPct = cost > 0 ? (pnl / cost * 100) : 0
        rows.push({ symbol: stock.symbol, qty, avgPrice, cost, ltp, mktVal, pnl, pnlPct, hasLTP: true })
      } else {
        const days = Math.max(...entries.map(e => calcDaysHeld(e.date)))
        const calcPrice = calcCurrentValue(avgPrice, entries[0].monthlyRate, entries[0].minReturn, days)
        const calcVal = qty * calcPrice
        totalMarketValue += calcVal
        rows.push({ symbol: stock.symbol, qty, avgPrice, cost, ltp: null, mktVal: calcVal, pnl: null, pnlPct: 0, hasLTP: false })
      }
    }

    const totalPnL = totalMarketValue - totalCost
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost * 100) : 0

    if (rows.length === 0) {
      body.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No active holdings</p>'
      return
    }

    body.innerHTML = `
      <div class="grid grid-cols-3 gap-2 text-xs mb-3">
        <div class="bg-gray-50 rounded-lg p-2">
          <div class="text-gray-400">Invested</div>
          <div class="font-semibold text-xs">${formatCurrencyFull(totalCost)}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2">
          <div class="text-gray-400">Market Value</div>
          <div class="font-semibold text-xs">${formatCurrencyFull(totalMarketValue)}</div>
        </div>
        <div class="bg-gray-50 rounded-lg p-2">
          <div class="text-gray-400">P&amp;L</div>
          <div class="font-semibold text-xs font-mono ${totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}">${formatCurrencyFull(totalPnL)} (${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%)</div>
        </div>
      </div>
      ${liveCount > 0 ? `<div class="text-[10px] text-green-600 mb-2">✓ ${liveCount} of ${rows.length} stocks have live prices</div>` : activeSymbols.length > 0 ? `<div class="text-[10px] text-amber-600 mb-2">Live prices unavailable — showing calculated values</div>` : ''}
      <table class="w-full text-xs">
        <thead><tr class="text-gray-400 border-b border-gray-100">
          <th class="text-left py-1 pr-1">Stock</th>
          <th class="text-right py-1 pr-1">Qty</th>
          <th class="text-right py-1 pr-1">Avg</th>
          <th class="text-right py-1 pr-1">LTP</th>
          <th class="text-right py-1">P&amp;L</th>
        </tr></thead>
        <tbody>${rows.map(r => {
          const pnlClass = r.pnl != null ? (r.pnl >= 0 ? 'text-green-600' : 'text-red-600') : ''
          const pnlStr = r.pnl != null ? `${formatCurrencyFull(r.pnl)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(1)}%)` : '-'
          return `
          <tr class="border-b border-gray-50">
            <td class="py-1.5 pr-1 font-semibold">${escHtml(r.symbol)}${!r.hasLTP ? ' <span class="text-gray-300 text-[9px]">(calc)</span>' : ''}</td>
            <td class="py-1.5 pr-1 text-right">${r.qty}</td>
            <td class="py-1.5 pr-1 text-right font-mono">${formatCurrencyFull(r.avgPrice)}</td>
            <td class="py-1.5 pr-1 text-right font-mono">${r.ltp != null ? formatCurrencyFull(r.ltp) : '-'}</td>
            <td class="py-1.5 text-right font-mono ${pnlClass}">${pnlStr}</td>
          </tr>`
        }).join('')}</tbody>
      </table>
    `
  }

  await loadLivePrices()

  document.getElementById('refresh-live-btn').addEventListener('click', loadLivePrices)
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

async function showStockDetail(stockId) {
  const stock = allStocks.find(s => s._id === stockId)
  if (!stock) return

  const entries = await getStockEntries(stockId)
  const activeEntries = entries.filter(e => e.remainingQty > 0)
  const partners = [...new Set(entries.map(e => e.partnerName).filter(Boolean))]
  let selectedPartner = ''
  let stockTab = 'holding'

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
      </div>
    `

    const holdingTable = holding.length > 0 ? `
      <div class="mt-2">
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
            return `
              <tr class="border-b border-gray-50">
                <td class="py-1.5 pr-1">${e.remainingQty}</td>
                <td class="py-1.5 pr-1">${formatCurrencyFull(e.price)}</td>
                <td class="py-1.5 pr-1">${formatDate(e.date)}</td>
                <td class="py-1.5 pr-1">${days}d</td>
                <td class="py-1.5 text-right font-mono ${riskColor}">${formatCurrencyFull(cv)}</td>
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
          <div><span class="text-gray-400">Price</span><br><span class="font-semibold">${avgPrice > 0 ? formatCurrencyFull(avgPrice) : '-'}</span></div>
          <div><span class="text-gray-400">Value</span><br><span class="font-semibold">${avgValue > 0 ? formatCurrencyFull(avgValue) : '-'}</span></div>
        </div>
        ${holding.length > 0 ? `
          <div class="flex gap-2 mt-2">
            <button class="btn-primary text-xs flex-1 py-1.5" id="detail-buy">Buy</button>
            <button class="btn-danger text-xs flex-1 py-1.5" id="detail-sell">Sell</button>
          </div>
        ` : ''}
        ${holdingTable}
      ` : soldTable}
    `
  }

  function bindDetailActions() {
    const stockId = stock._id
    document.querySelectorAll('.partner-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        selectedPartner = tab.dataset.partner
        const body = document.querySelector('.modal-body')
        if (body) body.innerHTML = renderDetailContent(selectedPartner, stockTab)
        bindDetailActions()
      })
    })
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        stockTab = tab.dataset.view
        const body = document.querySelector('.modal-body')
        if (body) body.innerHTML = renderDetailContent(selectedPartner, stockTab)
        bindDetailActions()
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
    title: editEntry ? 'Edit Entry' : 'Buy Stock',
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
      <p class="text-sm font-semibold">${escHtml(stock.symbol)}</p>
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
    title: 'Sell Stock',
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
