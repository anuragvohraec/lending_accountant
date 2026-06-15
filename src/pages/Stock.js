import { getMoneySources, getAllStockSymbols, saveStockSymbol, getStockEntries, getStockEntry, saveStockEntry, deleteStockEntry } from '../db/database.js'
import { getSettings, saveSettings } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDate } from '../utils/formatters.js'
import { dateInputHTML, setupDateInput, getDateInputValue } from '../utils/dateInput.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showPrompt } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
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

  el.innerHTML = allStocks.map(s => {
      const entries = entriesByStock[s._id] || []
      const activeEntries = entries.filter(e => e.remainingQty > 0)
      const totalQty = calcTotalQty(activeEntries)
      const avgPrice = calcAvgBuyPrice(activeEntries)
      const avgDays = calcAvgDays(activeEntries)
      const avgValue = calcAggregatedCurrentValue(activeEntries)

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
    }).join('')

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
          <tbody>${sold.map(e => {
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
    entry.remainingQty -= take
    entry.updatedAt = new Date().toISOString()
    if (entry.remainingQty === 0) {
      entry.status = 'sold'
      entry.soldPrice = result.price
      entry.soldDate = result.date
    }
    await saveStockEntry(entry)
  }

  logAction('update', 'stock_entry', '', `Sold ${result.qty} units of ${stock.symbol} @ ${result.price} (LIFO for ${result.partnerName})`)

  const gain = result.qty * (result.price - calcAvgBuyPrice(sellEntries))
  showToast(`Sold ${result.qty} units` + (gain >= 0 ? ` — gain: ${formatCurrencyFull(gain)}` : ''))

  allStocks = await getAllStockSymbols()
  allStocks.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''))
  renderStockList()
  return true
}
