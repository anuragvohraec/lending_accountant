import { renderHeader } from '../components/Header.js'
import { showConfirm, showPrompt } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import {
  getWarehouses, getWarehouse, saveWarehouse, deleteWarehouse,
  getHalls, saveHall, deleteHall,
  getSections, saveSection, deleteSection,
  getStocksBySection, getStock, saveStock, deleteStock,
  getStocksByWarehouse,
  getStockTxns, addStockTxn, addStockNote,
  getBills, saveBill, deleteBill, getParties,
} from '../services/warehouse.js'

const GRID = 20
const SNAP_DIST = 12
const CANVAS_W = 4000
const CANVAS_H = 4000

let W = null
const S = {
  warehouseId: null, mode: 'select',
  selectedId: null, selectedType: null,
  halls: [], sections: [], stocks: [],
  drawing: false, drawStart: { x: 0, y: 0 }, drawCur: { x: 0, y: 0 },
  panX: 0, panY: 0, zoom: 1,
  // drag / resize / pan state
  act: null,          // null | 'move' | 'resize' | 'pan' | 'draw'
  actTarget: null,    // element being moved/resized
  actHandle: null,    // handle position for resize
  actStart: null,     // { sx, sy, ex, ey } screen coords at start
  actOrig: null,      // original element bounds (x,y,w,h)
  editMode: false,
  fullscreen: false,
}
let svgEl = null
let svgWrap = null
let panPending = false

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function snap(v) { return Math.round(v / GRID) * GRID }

function buildStockContext(stock, halls, sections) {
  halls = halls || S.halls; sections = sections || S.sections
  const sec = sections.find(s => s._id === stock.sectionId)
  const hall = sec ? halls.find(h => h._id === sec.hallId) : null
  return {
    warehouseName: '',
    hallName: hall?.name || '',
    sectionName: sec?.name || '',
    partyName: stock.partyName || '',
    itemName: stock.itemName || '',
  }
}

async function showStockAudit(stock, halls, sections) {
  const txns = await getStockTxns(stock._id)
  const ctx = buildStockContext(stock, halls, sections)
  const html = txns.length === 0 ? '<p class="text-xs text-gray-400 text-center py-4">No changes logged.</p>' :
    txns.map(t => `
      <div class="text-xs border-b border-gray-100 py-2 flex flex-col gap-0.5">
        <div class="flex items-center justify-between">
          <span class="font-medium ${t.type === 'add' ? 'text-green-600' : 'text-red-600'}">${t.delta} ${t.delta === 1 ? 'unit' : 'units'} ${t.type === 'add' ? 'added' : 'removed'}</span>
          <span class="text-[10px] text-gray-400">${new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="text-gray-500">${t.prevQty} → ${t.newQty}</div>
        ${t.note ? `<div class="text-gray-400 italic">"${esc(t.note)}"</div>` : ''}
      </div>
    `).join('')

  const container = document.getElementById('modal-container')
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black/40" data-dismiss></div>
    <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[80vh] overflow-y-auto slide-up p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm">Audit — ${esc(stock.partyName || '')}</h3>
        <button class="btn-icon btn-ghost -mr-1" data-dismiss><ion-icon name="close-outline" class="text-lg"></ion-icon></button>
      </div>
      ${ctx.hallName ? `<div class="text-[10px] text-gray-400 mb-3">${esc(ctx.hallName)} / ${esc(ctx.sectionName)} · ${esc(ctx.itemName)}</div>` : ''}
      ${html}
      <button class="btn-outline w-full mt-3 text-sm" data-dismiss>Close</button>
    </div>`
  container.appendChild(modal)
  modal.querySelectorAll('[data-dismiss]').forEach(el => el.addEventListener('click', () => modal.remove()))
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })
}

async function showQtyEditModal(stock, prefillQty, ctx) {
  return new Promise(resolve => {
    ctx = ctx || buildStockContext(stock)
    const isNoteOnly = prefillQty !== undefined
    const container = document.getElementById('modal-container')
    const modal = document.createElement('div')
    modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
    modal.innerHTML = `
      <div class="fixed inset-0 bg-black/40" data-dismiss></div>
      <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm slide-up p-5">
        <h3 class="font-bold text-sm mb-1">${isNoteOnly ? 'Quantity Change Note' : 'Edit Quantity'}</h3>
        <div class="text-xs text-gray-400 mb-4">${esc(ctx.hallName)} / ${esc(ctx.sectionName)} · ${esc(stock.partyName || '')} · ${esc(ctx.itemName)}<br>Current quantity: <strong>${stock.quantity || 0}</strong>${isNoteOnly ? ` → <strong>${prefillQty}</strong>` : ''}</div>
        ${isNoteOnly ? '' : `<label class="input-label">New Quantity</label><input type="number" id="mqty-input" class="input mb-3" value="${stock.quantity || 0}" min="0" autofocus>`}
        <label class="input-label">Note <span class="text-red-500">*</span></label>
        <textarea id="mqty-note" class="input mb-4" rows="2" placeholder="Why is this changing?" ${isNoteOnly ? 'autofocus' : ''}></textarea>
        <div class="flex gap-3">
          <button class="btn-outline flex-1" data-dismiss>Cancel</button>
          <button class="btn-primary flex-1" id="mqty-save">Save</button>
        </div>
      </div>`
    container.appendChild(modal)
    modal.querySelectorAll('[data-dismiss]').forEach(el => el.addEventListener('click', () => { modal.remove(); resolve(null) }))
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null) } })
    document.getElementById('mqty-save').addEventListener('click', () => {
      const qty = isNoteOnly ? prefillQty : parseInt(document.getElementById('mqty-input').value)
      const note = document.getElementById('mqty-note').value.trim()
      if (!isNoteOnly && (isNaN(qty) || qty < 0)) { showToast('Enter a valid quantity'); return }
      if (!note) { document.getElementById('mqty-note').focus(); showToast('Note is required'); return }
      modal.remove(); resolve({ qty, note })
    })
    if (!isNoteOnly) {
      document.getElementById('mqty-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('mqty-save').click()
      })
    }
  })
}

// ── ENTRY ──

export async function renderWarehouse(main) {
  W = main; resetState(); await showList()
}
function resetState() {
  S.warehouseId = null; S.mode = 'select'
  S.selectedId = null; S.selectedType = null
  S.halls = []; S.sections = []; S.stocks = []
  S.drawing = false; S.panX = 0; S.panY = 0; S.zoom = 1
  S.act = null; S.actTarget = null; S.actHandle = null
  S.editMode = false; S.fullscreen = false
  panPending = false
}

// ── WAREHOUSE LIST ──

async function showList() {
  const whs = await getWarehouses()
  W.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Warehouses</h2>
      <button id="wh-new" class="btn-primary text-sm px-3 py-1.5">+ New</button>
    </div>
    <div class="space-y-2">
      ${whs.length === 0 ? '<p class="text-sm text-gray-400 text-center py-8">No warehouses yet.</p>' :
        whs.map(w => `
          <div class="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer active:bg-gray-50" data-id="${w._id}">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-gray-900 truncate">${esc(w.name)}</div>
              <div class="text-xs text-gray-400 mt-0.5">Tap to edit layout</div>
            </div>
            <button class="btn-icon btn-ghost text-gray-400 wh-details" data-id="${w._id}" title="View details"><ion-icon name="list-outline" class="text-lg"></ion-icon></button>
            <button class="btn-icon btn-ghost text-gray-400 -mr-2 wh-del" data-id="${w._id}"><ion-icon name="trash-outline" class="text-lg"></ion-icon></button>
          </div>
        `).join('')}
    </div>`
  document.getElementById('wh-new').addEventListener('click', promptNewWh)
  W.querySelectorAll('[data-id]').forEach(el => {
    if (el.classList.contains('wh-del')) return
    if (el.classList.contains('wh-details')) return
    el.addEventListener('click', e => { if (!e.target.closest('.wh-del') && !e.target.closest('.wh-details')) showCanvas(el.dataset.id) })
  })
  W.querySelectorAll('.wh-details').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      await showWarehouseDetails(btn.dataset.id)
    })
  })
  W.querySelectorAll('.wh-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation()
      const ok = await showConfirm({ title: 'Delete Warehouse', message: 'Delete this warehouse and all its data?', confirmText: 'Delete', danger: true })
      if (ok) { await deleteWarehouse(btn.dataset.id); await showList() }
    })
  })
}
async function promptNewWh() {
  const name = prompt('Warehouse name:')
  if (!name || !name.trim()) return
  await saveWarehouse({ name: name.trim() })
  const all = await getWarehouses()
  const match = all.find(w => w.name === name.trim())
  if (match) await showCanvas(match._id)
  else await showList()
}

async function showWarehouseDetails(whId) {
  const wh = await getWarehouse(whId).catch(() => null)
  if (!wh) return
  const halls = await getHalls(whId)
  const sections = [], stocks = []
  for (const h of halls) {
    const secs = await getSections(h._id)
    sections.push(...secs)
    for (const s of secs) stocks.push(...(await getStocksBySection(s._id)))
  }

  const rows = []
  let totalStocks = 0
  for (const h of halls) {
    const hSecs = sections.filter(s => s.hallId === h._id)
    rows.push(`<div class="font-semibold text-sm text-gray-800 px-2 py-1.5 bg-gray-50 rounded flex items-center gap-2 mt-1"><span class="w-3 h-3 rounded" style="background:${h.color || '#6366F1'}"></span>${esc(h.name)} <span class="text-[10px] text-gray-400 font-normal">(${hSecs.length} sections)</span></div>`)
    for (const sec of hSecs) {
      const secStocks = stocks.filter(st => st.sectionId === sec._id)
      rows.push(`<div class="pl-6 text-xs text-gray-600 py-1 flex items-center gap-2"><span class="w-2 h-2 rounded" style="background:${sec.color || '#8B5CF6'}"></span>${esc(sec.name)} <span class="text-[10px] text-gray-400">(${secStocks.length} stocks)</span></div>`)
      for (const st of secStocks) {
        totalStocks++
        rows.push(`<div class="pl-12 text-xs py-0.5 flex items-center gap-2"><span class="w-2 h-2 rounded shrink-0" style="background:${st.color || '#eef2ff'};border:1px solid #ccc"></span><span class="font-medium truncate">${esc(st.partyName || '')}</span><span class="text-gray-400 shrink-0">·</span><span class="truncate">${esc(st.itemName || '-')}</span><button class="wh-qty-edit text-xs font-semibold text-primary shrink-0 ml-auto" data-stock-id="${st._id}">Qty: ${st.quantity || 0}</button><button class="wh-audit btn-icon btn-ghost text-gray-400 shrink-0 -mr-1" data-stock-id="${st._id}" title="Audit log"><ion-icon name="time-outline" class="text-sm"></ion-icon></button></div>`)
      }
      if (!secStocks.length) rows.push(`<div class="pl-12 text-[10px] text-gray-400 italic">No stocks</div>`)
    }
  }

  W.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <button id="wh-back" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
      <h2 class="text-base font-bold truncate flex-1 text-center">${esc(wh.name)}</h2>
      <span class="text-xs text-gray-400 font-mono">${stocks.length} stocks</span>
    </div>
    <div class="space-y-0.5 text-sm">${rows.join('')}</div>
    ${!halls.length ? '<p class="text-sm text-gray-400 text-center py-8">No halls yet.</p>' : ''}
    <div class="mt-4 text-center">
      <button id="wh-open-canvas" class="btn-primary text-sm px-4 py-1.5">Open Layout</button>
    </div>`
  document.getElementById('wh-back').addEventListener('click', () => showList())
  document.getElementById('wh-open-canvas')?.addEventListener('click', () => showCanvas(whId))

  W.querySelectorAll('.wh-qty-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stock = stocks.find(st => st._id === btn.dataset.stockId)
      if (!stock) return
      const ctx = buildStockContext(stock, halls, sections)
      const result = await showQtyEditModal(stock, undefined, ctx)
      if (!result) return
      const prevQty = stock.quantity || 0
      const delta = result.qty - prevQty
      if (delta === 0) { showToast('Quantity unchanged'); return }
      stock.quantity = result.qty
      await saveStock(stock)
      await addStockTxn({ stockId: stock._id, type: delta > 0 ? 'add' : 'reduce', delta: Math.abs(delta), prevQty, newQty: result.qty, note: result.note, ...ctx })
      showToast('Quantity updated')
      await showWarehouseDetails(whId)
    })
  })
  W.querySelectorAll('.wh-audit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stock = stocks.find(st => st._id === btn.dataset.stockId)
      if (stock) await showStockAudit(stock, halls, sections)
    })
  })
}

// ── CANVAS ──

async function showCanvas(whId) {
  S.warehouseId = whId; S.panX = 0; S.panY = 0; S.zoom = 1
  const wh = await getWarehouse(whId).catch(() => null)
  if (!wh) { await showList(); return }
  await loadData()
  S.editMode = false
  centerPan()

  W.innerHTML = `
    <div class="flex flex-col h-full">
      <div id="wh-canvas-header" class="flex items-center justify-between px-1 py-1 shrink-0">
        <button id="wh-back" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
        <h2 class="text-sm font-bold truncate text-center flex-1 px-2">${esc(wh.name)}</h2>
        <button id="wh-billing-btn" class="btn-icon btn-ghost text-gray-400"><ion-icon name="receipt-outline" class="text-lg"></ion-icon></button>
      </div>
      <div id="wh-toolbar" class="flex items-center gap-1 px-2 py-1.5 border-y border-gray-100 overflow-x-auto shrink-0"></div>
      <div id="wh-canvas-wrap" class="flex-1 relative bg-gray-50 overflow-hidden">
        <div id="wh-svg-wrap"><svg id="wh-svg" width="100%" height="100%"></svg></div>
        <div id="wh-handle-layer" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></div>
      </div>
      <div id="wh-details" class="shrink-0 border-t border-gray-100 bg-white px-3 py-2 min-h-[38px]"></div>
    </div>`

  svgWrap = document.getElementById('wh-svg-wrap')
  svgEl = document.getElementById('wh-svg')

  document.getElementById('wh-back').addEventListener('click', () => showList())
  const billBtn = document.getElementById('wh-billing-btn')
  if (billBtn) billBtn.addEventListener('click', () => showBilling())

  applyViewBox()
  renderToolbar()
  renderCanvas()
  renderDetails()

  svgEl.addEventListener('pointerdown', onPointerDown)
  svgEl.addEventListener('pointermove', onPointerMove)
  svgEl.addEventListener('pointerup', onPointerUp)
  svgEl.addEventListener('pointerleave', onPointerLeave)
  document.getElementById('wh-handle-layer')?.addEventListener('pointerdown', onPointerDown)
}

function centerPan() {
  if (S.halls.length) {
    const cx = S.halls.reduce((a, h) => a + h.x + h.width / 2, 0) / S.halls.length
    const cy = S.halls.reduce((a, h) => a + h.y + h.height / 2, 0) / S.halls.length
    const wrap = document.getElementById('wh-canvas-wrap')
    if (wrap) {
      const vw = CANVAS_W / S.zoom, vh = CANVAS_H / S.zoom
      S.panX = Math.max(0, cx - vw / 2)
      S.panY = Math.max(0, cy - vh / 2)
    }
  }
}

async function loadData() {
  S.halls = await getHalls(S.warehouseId)
  S.sections = []; S.stocks = []
  for (const h of S.halls) {
    const secs = await getSections(h._id)
    S.sections.push(...secs)
    for (const s of secs) S.stocks.push(...(await getStocksBySection(s._id)))
  }
  for (const h of S.halls) {
    if (h.x == null) h.x = 400; if (h.y == null) h.y = 300
    if (!h.width) h.width = 300; if (!h.height) h.height = 200
    if (!h.color) h.color = '#6366F1'
  }
  for (const s of S.sections) {
    if (s.x == null) s.x = GRID; if (s.y == null) s.y = GRID * 2
    if (!s.width) s.width = 200; if (!s.height) s.height = 100
    if (!s.color) s.color = '#8B5CF6'
  }
  for (const st of S.stocks) {
    if (st.x == null) st.x = 4; if (st.y == null) st.y = 4
    if (!st.width) st.width = 90; if (!st.height) st.height = 20
    if (!st.color) st.color = '#eef2ff'
  }
}

// ── VIEWBOX ──

function applyViewBox() {
  if (!svgEl) return
  const vw = CANVAS_W / S.zoom, vh = CANVAS_H / S.zoom
  svgEl.setAttribute('viewBox', `${S.panX} ${S.panY} ${vw} ${vh}`)
}

// ── TOOLBAR ──

const MODES = [
  { id: 'select', icon: 'hand-left-outline', label: 'Select' },
  { id: 'hall', icon: 'square-outline', label: 'Hall' },
  { id: 'section', icon: 'stop-outline', label: 'Section' },
  { id: 'stock', icon: 'cube-outline', label: 'Stock' },
]

function renderToolbar() {
  const bar = document.getElementById('wh-toolbar')
  if (!bar) return

  const zoomCtrl = `<span class="text-[10px] text-gray-400 font-mono ml-auto shrink-0">${Math.round(S.zoom * 100)}%</span>
    <button id="wh-zoom-out" class="wh-tool-btn flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 border border-transparent shrink-0"><ion-icon name="remove-outline" class="text-sm"></ion-icon></button>
    <button id="wh-zoom-in" class="wh-tool-btn flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 border border-transparent shrink-0"><ion-icon name="add-outline" class="text-sm"></ion-icon></button>
    <button id="wh-zoom-fit" class="wh-tool-btn flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 border border-transparent shrink-0"><ion-icon name="scan-outline" class="text-sm"></ion-icon></button>
    <button id="wh-fullscreen-btn" class="wh-tool-btn flex items-center justify-center w-7 h-7 rounded-lg text-gray-500 hover:bg-gray-100 border border-transparent shrink-0"><ion-icon name="${S.fullscreen ? 'contract-outline' : 'expand-outline'}" class="text-sm"></ion-icon></button>`

  if (!S.editMode) {
    bar.innerHTML =
      `<button id="wh-edit-toggle" class="wh-tool-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border-primary"><ion-icon name="create-outline" class="text-base"></ion-icon><span class="hidden sm:inline">Edit</span></button>${zoomCtrl}`
  } else {
    bar.innerHTML =
      `<button id="wh-edit-toggle" class="wh-tool-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600"><ion-icon name="eye-outline" class="text-base"></ion-icon><span class="hidden sm:inline">Done</span></button>` +
      MODES.map(m => {
        let disabled = false
        if (m.id === 'section' && S.selectedType !== 'hall') disabled = true
        if (m.id === 'stock' && S.selectedType !== 'section') disabled = true
        const a = S.mode === m.id ? 'bg-primary/10 text-primary border-primary' : 'text-gray-500 border-transparent'
        const iconHtml = m.id === 'hall' ? '<span class="text-xs font-bold w-4 text-center">H</span>' : m.id === 'section' ? '<span class="text-xs font-bold w-4 text-center">S</span>' : `<ion-icon name="${m.icon}" class="text-base"></ion-icon>`
        return `<button class="wh-tool-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${a} ${disabled ? 'opacity-30' : ''}" data-mode="${m.id}" ${disabled ? 'disabled' : ''}>
          ${iconHtml}<span class="hidden sm:inline">${m.label}</span>
        </button>`
      }).join('') +
      zoomCtrl +
      (S.selectedId ? `<button id="wh-tool-del" class="wh-tool-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 border border-transparent hover:bg-red-50 shrink-0"><ion-icon name="trash-outline" class="text-base"></ion-icon><span class="hidden sm:inline">Delete</span></button>` : '')
  }

  bar.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => { if (!btn.disabled) setMode(btn.dataset.mode) })
  })
  document.getElementById('wh-zoom-out')?.addEventListener('click', () => zoomBy(-0.2))
  document.getElementById('wh-zoom-in')?.addEventListener('click', () => zoomBy(0.2))
  document.getElementById('wh-zoom-fit')?.addEventListener('click', zoomFit)
  const delBtn = document.getElementById('wh-tool-del')
  if (delBtn) delBtn.addEventListener('click', deleteSelected)
  document.getElementById('wh-edit-toggle')?.addEventListener('click', toggleEditMode)
  document.getElementById('wh-fullscreen-btn')?.addEventListener('click', toggleFullscreen)
}

function setMode(mode) {
  if (mode === 'section' && S.selectedType !== 'hall') return
  if (mode === 'stock' && S.selectedType !== 'section') return
  S.mode = mode; S.act = null; S.drawing = false
  renderToolbar()
}

function zoomBy(delta) {
  S.zoom = Math.max(0.2, Math.min(5, +(S.zoom + delta).toFixed(2)))
  applyViewBox(); renderCanvas()
}

function zoomFit() {
  if (!S.halls.length) { S.panX = 0; S.panY = 0; S.zoom = 1; applyViewBox(); renderCanvas(); return }
  const wrap = document.getElementById('wh-canvas-wrap')
  if (!wrap) return
  const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight
  if (!wrapW || !wrapH) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const h of S.halls) {
    const secs = S.sections.filter(s => s.hallId === h._id)
    for (const sec of secs) {
      const sts = S.stocks.filter(st => st.sectionId === sec._id)
      for (const st of sts) {
        const ax = h.x + sec.x + st.x + st.width, ay = h.y + sec.y + st.y + st.height
        if (h.x + sec.x + st.x < minX) minX = h.x + sec.x + st.x
        if (ay < minY) minY = ay
        if (ax > maxX) maxX = ax
        if (ay > maxY) maxY = ay
      }
      const ax = h.x + sec.x + sec.width, ay = h.y + sec.y + sec.height
      if (h.x + sec.x < minX) minX = h.x + sec.x
      if (h.y + sec.y < minY) minY = h.y + sec.y
      if (ax > maxX) maxX = ax; if (ay > maxY) maxY = ay
    }
    if (h.x < minX) minX = h.x; if (h.y < minY) minY = h.y
    if (h.x + h.width > maxX) maxX = h.x + h.width
    if (h.y + h.height > maxY) maxY = h.y + h.height
  }
  if (minX === Infinity) { minX = 0; minY = 0; maxX = 800; maxY = 600 }
  const pad = 60
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(CANVAS_W, maxX + pad); maxY = Math.min(CANVAS_H, maxY + pad)
  const contentW = maxX - minX, contentH = maxY - minY
  const zoomX = wrapW / contentW, zoomY = wrapH / contentH
  S.zoom = Math.min(zoomX, zoomY, 2)
  S.panX = minX; S.panY = minY
  applyViewBox(); renderCanvas()
}

function toggleEditMode() {
  S.editMode = !S.editMode
  if (!S.editMode) { S.mode = 'select'; S.act = null; S.drawing = false; clearSelection() }
  renderToolbar(); renderCanvas()
}

function toggleFullscreen() {
  S.fullscreen = !S.fullscreen
  const header = document.getElementById('wh-canvas-header')
  const toolbar = document.getElementById('wh-toolbar')
  const details = document.getElementById('wh-details')
  const modalPanel = document.getElementById('apps-modal-panel')
  const modalHeader = document.getElementById('apps-modal-header')
  const modalBody = document.getElementById('apps-modal-body')

  if (S.fullscreen) {
    if (header) header.style.display = 'none'
    if (toolbar) toolbar.style.display = ''
    if (details) details.style.display = 'none'
    if (modalPanel) {
      modalPanel.style.width = '100vw'
      modalPanel.style.height = '100vh'
      modalPanel.style.maxWidth = ''
      modalPanel.style.borderRadius = '0'
    }
    if (modalHeader) modalHeader.style.display = 'none'
    if (modalBody) { modalBody.style.padding = '0'; modalBody.style.overflow = 'hidden' }
  } else {
    if (header) header.style.display = ''
    if (details) details.style.display = ''
    if (modalPanel) {
      modalPanel.style.width = ''
      modalPanel.style.height = ''
      modalPanel.style.maxWidth = ''
      modalPanel.style.borderRadius = ''
    }
    if (modalHeader) modalHeader.style.display = ''
    if (modalBody) { modalBody.style.padding = ''; modalBody.style.overflow = '' }
  }
  renderToolbar()
  if (!S.fullscreen) { applyViewBox(); renderHandles() }
  else setTimeout(() => { applyViewBox(); renderHandles() }, 50)
}

// ── SVG RENDER ──

function renderCanvas() {
  if (!svgEl) return

  const gridLines = []
  for (let i = 0; i <= CANVAS_W / GRID; i++) {
    const x = i * GRID
    const big = x % (GRID * 5) === 0
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${CANVAS_H}" stroke="${big ? '#888' : '#c0c0c0'}" stroke-width="${big ? 1.5 : 1}"/>`)
  }
  for (let i = 0; i <= CANVAS_H / GRID; i++) {
    const y = i * GRID
    const big = y % (GRID * 5) === 0
    gridLines.push(`<line x1="0" y1="${y}" x2="${CANVAS_W}" y2="${y}" stroke="${big ? '#888' : '#c0c0c0'}" stroke-width="${big ? 1.5 : 1}"/>`)
  }

  svgEl.innerHTML = `
    <g id="wh-grid" pointer-events="none">
      <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="white"/>
      ${gridLines.join('')}
    </g>
    <g id="wh-elements">
      ${S.halls.map(h => {
        const hSel = S.selectedId === h._id && S.selectedType === 'hall'
        const hRes = hSel && S.act === 'resize'
        return `
        <g class="wh-g-hall ${hSel ? 'selected' : ''}" transform="translate(${h.x}, ${h.y})" data-id="${h._id}" data-type="hall">
          <rect class="wh-hall" x="0" y="0" width="${h.width}" height="${h.height}" fill="${h.color}20" stroke="${hRes ? '#1d4ed8' : (hSel ? '#3b82f6' : h.color)}" stroke-width="${hRes ? 6 : (hSel ? 3 : 2)}" rx="4"/>
          ${S.sections.filter(s => s.hallId === h._id).map(sec => {
            const sSel = S.selectedId === sec._id && S.selectedType === 'section'
            const sRes = sSel && S.act === 'resize'
            return `
            <g class="wh-g-section ${sSel ? 'selected' : ''}" transform="translate(${sec.x}, ${sec.y})" data-id="${sec._id}" data-type="section">
              <rect class="wh-section" x="0" y="0" width="${sec.width}" height="${sec.height}" fill="${sec.color}20" stroke="${sRes ? '#1d4ed8' : (sSel ? '#3b82f6' : sec.color)}" stroke-width="${sRes ? 5 : (sSel ? 2.5 : 1.5)}" rx="3"/>
              ${S.stocks.filter(st => st.sectionId === sec._id).map(st => {
                const stSel = S.selectedId === st._id && S.selectedType === 'stock'
                const stRes = stSel && S.act === 'resize'
                return `
                <g class="wh-g-stock ${stSel ? 'selected' : ''}" transform="translate(${st.x}, ${st.y})" data-id="${st._id}" data-type="stock">
                  <rect class="wh-stock" x="0" y="0" width="${st.width}" height="${st.height}" fill="${st.color}${stSel ? '' : '50'}" stroke="${stRes ? '#1d4ed8' : (stSel ? st.color : '#6366F1')}" stroke-width="${stRes ? 4 : (stSel ? 2 : 0.5)}" rx="2"/>
                </g>`
              }).join('')}
            </g>`
          }).join('')}
        </g>`
      }).join('')}
    </g>
    ${S.drawing ? (() => {
      const x = Math.min(S.drawStart.x, S.drawCur.x)
      const y = Math.min(S.drawStart.y, S.drawCur.y)
      const w = Math.abs(S.drawCur.x - S.drawStart.x)
      const hh = Math.abs(S.drawCur.y - S.drawStart.y)
      return `<rect id="wh-preview" x="${x}" y="${y}" width="${w}" height="${hh}" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6,3" rx="3"/>`
    })() : ''}`
  requestAnimationFrame(renderHandles)
}

function renderHandles() {
  const layer = document.getElementById('wh-handle-layer')
  if (!layer) return

  const wrapRect = document.getElementById('wh-canvas-wrap')?.getBoundingClientRect()
  if (!wrapRect) return

  const parts = []

  // Labels for ALL entities
  function addLabel(entity, type, label) {
    if (!label) return
    const abs = getAbsBounds(entity, type)
    if (!abs) return
    const sp = svgToScreen(abs.x, abs.y)
    parts.push(`<div class="wh-label-overlay" style="position:absolute;left:${sp.x - wrapRect.left + 2}px;top:${sp.y - wrapRect.top + 2}px;font-size:11px;font-weight:600;color:#374151;pointer-events:none;white-space:nowrap;background:rgba(255,255,255,0.85);padding:1px 4px;border-radius:2px;z-index:9">${esc(label)}</div>`)
  }
  for (const h of S.halls) addLabel(h, 'hall', h.name)
  for (const sec of S.sections) addLabel(sec, 'section', sec.name)
  for (const st of S.stocks) addLabel(st, 'stock', st.partyName ? `${st.partyName} · ${st.itemName || '-'} (${st.quantity || 0})` : '')

  // Handles for selected entity (edit mode only)
  const el = getSelectedElement()
  if (S.editMode && el && S.selectedId) {
    const abs = getAbsBounds(el)
    if (abs) {
      const hSize = 14
      const cursors = { tl:'nwse-resize', tm:'ns-resize', tr:'nesw-resize', ml:'ew-resize', mr:'ew-resize', bl:'nesw-resize', bm:'ns-resize', br:'nwse-resize' }
      const pts = [
        [abs.x, abs.y, 'tl'], [abs.x + abs.w / 2, abs.y, 'tm'], [abs.x + abs.w, abs.y, 'tr'],
        [abs.x, abs.y + abs.h / 2, 'ml'], [abs.x + abs.w, abs.y + abs.h / 2, 'mr'],
        [abs.x, abs.y + abs.h, 'bl'], [abs.x + abs.w / 2, abs.y + abs.h, 'bm'], [abs.x + abs.w, abs.y + abs.h, 'br'],
      ]
      for (const [ux, uy, pos] of pts) {
        const sp = svgToScreen(ux, uy)
        parts.push(`<div class="wh-handle" data-handle="${pos}" style="position:absolute;left:${sp.x - wrapRect.left - hSize/2}px;top:${sp.y - wrapRect.top - hSize/2}px;width:${hSize}px;height:${hSize}px;pointer-events:auto;cursor:${cursors[pos]};background:white;border:2px solid #1d4ed8;border-radius:2px;z-index:10;box-sizing:border-box"></div>`)
      }
    }
  }

  layer.innerHTML = parts.join('')
}

// ── DETAILS ──

function renderDetails() {
  const panel = document.getElementById('wh-details')
  if (!panel) return
  if (!S.selectedId || !S.selectedType) {
    if (!S.editMode) { panel.innerHTML = ''; return }
    const hint = S.mode === 'hall' ? 'Click & drag on canvas to create a hall' :
      S.mode === 'section' ? 'Select a hall first, then drag inside it' :
      S.mode === 'stock' ? 'Select a section first, then drag inside it' :
      'Select a tool above, then draw on the canvas'
    panel.innerHTML = `<p class="text-xs text-gray-400 text-center py-1">${hint}</p>`; return
  }
  const el = getSelectedElement()
  if (!el) { panel.innerHTML = ''; return }
  if (S.selectedType === 'hall') {
    const secCount = S.sections.filter(s => s.hallId === el._id).length
    const secIds = S.sections.filter(s => s.hallId === el._id).map(s => s._id)
    const stCount = S.stocks.filter(st => secIds.includes(st.sectionId)).length
    if (!S.editMode) {
      panel.innerHTML = `<div class="flex items-center gap-2 text-sm py-0.5"><span class="font-semibold text-gray-800">${esc(el.name)}</span><span class="w-4 h-4 rounded border border-gray-300 shrink-0" style="background:${el.color}"></span><span class="text-[10px] text-gray-400 ml-auto">${el.width}×${el.height} · ${secCount} sections · ${stCount} stocks</span></div>`
      return
    }
    panel.innerHTML = `
      <div class="flex items-center gap-2 text-sm">
        <span class="text-gray-500 shrink-0">Hall:</span>
        <input id="wh-edit-name" class="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-sm" value="${esc(el.name)}">
        <input id="wh-edit-color" type="color" class="w-8 h-8 rounded border border-gray-200 shrink-0" value="${el.color || '#6366F1'}">
        <button id="wh-edit-save" class="btn-primary text-xs px-2 py-1 shrink-0">Save</button>
      </div>
      <div class="text-[10px] text-gray-400 mt-1">${el.width} × ${el.height} · ${secCount} sections · ${stCount} stocks</div>`
    document.getElementById('wh-edit-save')?.addEventListener('click', async () => {
      const name = document.getElementById('wh-edit-name').value.trim()
      if (!name) return
      el.name = name; el.color = document.getElementById('wh-edit-color').value
      await saveHall(el); await loadData(); renderCanvas(); renderDetails()
    })
  } else if (S.selectedType === 'section') {
    const stCount = S.stocks.filter(st => st.sectionId === el._id).length
    if (!S.editMode) {
      panel.innerHTML = `<div class="flex items-center gap-2 text-sm py-0.5"><span class="font-semibold text-gray-800">${esc(el.name)}</span><span class="w-4 h-4 rounded border border-gray-300 shrink-0" style="background:${el.color}"></span><span class="text-[10px] text-gray-400 ml-auto">${el.width}×${el.height} · ${stCount} stocks</span></div>`
      return
    }
    panel.innerHTML = `
      <div class="flex items-center gap-2 text-sm">
        <span class="text-gray-500 shrink-0">Section:</span>
        <input id="wh-edit-name" class="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 text-sm" value="${esc(el.name)}">
        <input id="wh-edit-color" type="color" class="w-8 h-8 rounded border border-gray-200 shrink-0" value="${el.color || '#8B5CF6'}">
        <button id="wh-edit-save" class="btn-primary text-xs px-2 py-1 shrink-0">Save</button>
      </div>
      <div class="text-[10px] text-gray-400 mt-1">${el.width} × ${el.height} · ${stCount} stocks</div>`
    document.getElementById('wh-edit-save')?.addEventListener('click', async () => {
      const name = document.getElementById('wh-edit-name').value.trim()
      if (!name) return
      el.name = name; el.color = document.getElementById('wh-edit-color').value
      await saveSection(el); await loadData(); renderCanvas(); renderDetails()
    })
  } else if (S.selectedType === 'stock') {
    if (!S.editMode) {
      panel.innerHTML = `<div class="flex items-center gap-2 text-sm py-0.5 flex-wrap"><span class="font-semibold text-gray-800">${esc(el.partyName || '')}</span><span class="text-gray-500">·</span><span>${esc(el.itemName || '')}</span><span class="text-gray-400 ml-auto">Qty: ${el.quantity || 0}</span></div>`
      return
    }
    panel.innerHTML = `
      <div class="flex items-center gap-2 text-sm flex-wrap">
        <input id="wh-edit-party" class="flex-1 min-w-[80px] px-2 py-1 rounded-lg border border-gray-200 text-sm" value="${esc(el.partyName || '')}" placeholder="Party">
        <input id="wh-edit-item" class="flex-1 min-w-[80px] px-2 py-1 rounded-lg border border-gray-200 text-sm" value="${esc(el.itemName || '')}" placeholder="Item">
        <input id="wh-edit-qty" type="number" class="w-16 px-2 py-1 rounded-lg border border-gray-200 text-sm" value="${el.quantity || 0}" min="0">
        <input id="wh-edit-color" type="color" class="w-8 h-8 rounded border border-gray-200 shrink-0" value="${el.color || '#eef2ff'}">
        <button id="wh-edit-save" class="btn-primary text-xs px-2 py-1 shrink-0">Save</button>
      </div>`
    document.getElementById('wh-edit-save')?.addEventListener('click', async () => {
      const partyName = document.getElementById('wh-edit-party').value.trim()
      const itemName = document.getElementById('wh-edit-item').value.trim()
      const quantity = parseInt(document.getElementById('wh-edit-qty').value) || 0
      if (!partyName || !itemName) { showToast('Party and item name required'); return }
      const prevQty = el.quantity || 0
      el.partyName = partyName; el.itemName = itemName; el.quantity = quantity; el.color = document.getElementById('wh-edit-color').value
      if (prevQty !== quantity) {
        const ctx = buildStockContext(el)
        const noteResult = await showQtyEditModal(el, quantity, ctx)
        if (!noteResult) { renderCanvas(); renderDetails(); return }
        await saveStock(el)
        const delta = quantity - prevQty
        await addStockTxn({ stockId: el._id, type: delta > 0 ? 'add' : 'reduce', delta: Math.abs(delta), prevQty, newQty: quantity, note: noteResult.note, ...ctx })
      } else {
        await saveStock(el)
      }
      await loadData(); renderCanvas(); renderDetails()
    })
  }
}

// ── COORDINATE HELPERS ──

function clientToSVG(e) {
  const pt = svgEl.createSVGPoint()
  pt.x = e.clientX; pt.y = e.clientY
  return pt.matrixTransform(svgEl.getScreenCTM().inverse())
}

// Get absolute canvas coordinates for an element
function getAbsBounds(el, type) {
  type = type || S.selectedType
  if (type === 'hall') return { x: el.x, y: el.y, w: el.width, h: el.height }
  if (type === 'section') {
    const h = S.halls.find(x => x._id === el.hallId)
    return h ? { x: h.x + el.x, y: h.y + el.y, w: el.width, h: el.height } : null
  }
  if (type === 'stock') {
    const sec = S.sections.find(x => x._id === el.sectionId)
    if (!sec) return null
    const h = S.halls.find(x => x._id === sec.hallId)
    return h ? { x: h.x + sec.x + el.x, y: h.y + sec.y + el.y, w: el.width, h: el.height } : null
  }
  return null
}

function svgToScreen(svgX, svgY) {
  const pt = svgEl.createSVGPoint()
  pt.x = svgX; pt.y = svgY
  return pt.matrixTransform(svgEl.getScreenCTM())
}

function setAbsBounds(el, absX, absY, absW, absH) {
  if (S.selectedType === 'hall') {
    el.x = snap(absX); el.y = snap(absY)
    el.width = snap(Math.max(GRID * 2, absW)); el.height = snap(Math.max(GRID * 2, absH))
    return
  }
  if (S.selectedType === 'section') {
    const h = S.halls.find(x => x._id === el.hallId)
    if (!h) return
    el.x = snap(Math.max(0, absX - h.x))
    el.y = snap(Math.max(0, absY - h.y))
    el.width = snap(Math.max(GRID, Math.min(absW, h.width - el.x)))
    el.height = snap(Math.max(GRID, Math.min(absH, h.height - el.y)))
    return
  }
  if (S.selectedType === 'stock') {
    const sec = S.sections.find(x => x._id === el.sectionId)
    if (!sec) return
    const h = S.halls.find(x => x._id === sec.hallId)
    if (!h) return
    const baseX = h.x + sec.x, baseY = h.y + sec.y
    el.x = snap(Math.max(0, absX - baseX))
    el.y = snap(Math.max(0, absY - baseY))
    el.width = snap(Math.max(GRID / 2, Math.min(absW, sec.width - el.x)))
    el.height = snap(Math.max(GRID / 2, Math.min(absH, sec.height - el.y)))
  }
}

// ── SNAP TO ELEMENTS ──

function getSiblings(el) {
  if (S.selectedType === 'hall') return S.halls.filter(h => h._id !== el._id)
  if (S.selectedType === 'section') return S.sections.filter(s => s._id !== el._id && s.hallId === el.hallId)
  if (S.selectedType === 'stock') return S.stocks.filter(st => st._id !== el._id && st.sectionId === el.sectionId)
  return []
}

function snapRectToSiblings(absX, absY, absW, absH, siblings) {
  if (!siblings.length) return { x: absX, y: absY }
  let bestDX = 0, bestDY = 0
  for (const sib of siblings) {
    const sibAbs = getAbsBounds(sib)
    if (!sibAbs) continue
    // Left edge snap
    const dLeft = absX - sibAbs.x
    if (Math.abs(dLeft) < SNAP_DIST && Math.abs(bestDX) > Math.abs(dLeft)) bestDX = -dLeft
    // Right edge snap (my left to their right)
    const dLeftToRight = absX - (sibAbs.x + sibAbs.w)
    if (Math.abs(dLeftToRight) < SNAP_DIST && Math.abs(bestDX) > Math.abs(dLeftToRight)) bestDX = -dLeftToRight
    // Right edge snap (my right to their left)
    const dRight = (absX + absW) - sibAbs.x
    if (Math.abs(dRight) < SNAP_DIST && Math.abs(bestDX) > Math.abs(dRight)) bestDX = -dRight
    // Right edge snap (my right to their right)
    const dRightToRight = (absX + absW) - (sibAbs.x + sibAbs.w)
    if (Math.abs(dRightToRight) < SNAP_DIST && Math.abs(bestDX) > Math.abs(dRightToRight)) bestDX = -dRightToRight

    // Top edge snap
    const dTop = absY - sibAbs.y
    if (Math.abs(dTop) < SNAP_DIST && Math.abs(bestDY) > Math.abs(dTop)) bestDY = -dTop
    // Top to bottom
    const dTopToBottom = absY - (sibAbs.y + sibAbs.h)
    if (Math.abs(dTopToBottom) < SNAP_DIST && Math.abs(bestDY) > Math.abs(dTopToBottom)) bestDY = -dTopToBottom
    // Bottom edge snap
    const dBottom = (absY + absH) - sibAbs.y
    if (Math.abs(dBottom) < SNAP_DIST && Math.abs(bestDY) > Math.abs(dBottom)) bestDY = -dBottom
    // Bottom to bottom
    const dBottomToBottom = (absY + absH) - (sibAbs.y + sibAbs.h)
    if (Math.abs(dBottomToBottom) < SNAP_DIST && Math.abs(bestDY) > Math.abs(dBottomToBottom)) bestDY = -dBottomToBottom
  }
  return { x: absX + bestDX, y: absY + bestDY }
}

// ── DELETE ──

async function deleteSelected() {
  if (!S.selectedId || !S.selectedType) return
  const el = getSelectedElement()
  const name = el?.name || el?.partyName || ''
  const ok = await showConfirm({ title: `Delete ${S.selectedType}`, message: `Delete "${name}"?`, confirmText: 'Delete', danger: true })
  if (!ok) return
  const t = S.selectedType; const id = S.selectedId
  S.selectedId = null; S.selectedType = null
  if (t === 'hall') await deleteHall(id)
  else if (t === 'section') await deleteSection(id)
  else if (t === 'stock') await deleteStock(id)
  await loadData(); renderToolbar(); renderCanvas(); renderDetails()
}

// ── POINTER EVENTS ──

function onPointerDown(e) {
  if (!S.editMode) {
    // View mode: selection + pan only
    const el = e.target.closest('[data-type]')
    if (el) {
      const id = el.dataset.id, type = el.dataset.type
      selectElement(id, type)
      return
    }
    clearSelection()
    S.act = 'pan'
    S.actStart = { sx: e.clientX, sy: e.clientY, px: S.panX, py: S.panY }
    svgEl.setPointerCapture(e.pointerId)
    return
  }

  const handle = e.target.closest('[data-handle]')
  if (handle && S.mode === 'select' && S.selectedId) {
    S.act = 'resize'; S.actHandle = handle.dataset.handle
    S.actTarget = getSelectedElement()
    const b = getAbsBounds(S.actTarget)
    S.actOrig = b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
    S.actStart = { sx: e.clientX, sy: e.clientY }
    svgEl.setPointerCapture(e.pointerId)
    return
  }

  const el = e.target.closest('[data-type]')
  if (el && S.mode === 'select') {
    const id = el.dataset.id, type = el.dataset.type
    if (id !== S.selectedId || type !== S.selectedType) selectElement(id, type)
    S.act = 'maybe-move'; S.actTarget = getSelectedElement()
    const b = getAbsBounds(S.actTarget)
    S.actOrig = b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null
    const svgPt = clientToSVG(e)
    S.actStart = { sx: e.clientX, sy: e.clientY, svgX: svgPt.x, svgY: svgPt.y }
    const abs = getAbsBounds(S.actTarget)
    S.actOffset = abs ? { x: svgPt.x - abs.x, y: svgPt.y - abs.y } : { x: 0, y: 0 }
    svgEl.setPointerCapture(e.pointerId)
    return
  }

  if (S.mode === 'hall' || S.mode === 'section' || S.mode === 'stock') {
    startDraw(e)
    if (S.drawing) svgEl.setPointerCapture(e.pointerId)
    return
  }

  if (S.mode === 'select') {
    clearSelection()
    S.act = 'pan'
    S.actStart = { sx: e.clientX, sy: e.clientY, px: S.panX, py: S.panY }
    svgEl.setPointerCapture(e.pointerId)
  }
}

function onPointerMove(e) {
  if (!S.editMode) {
    if (S.act === 'pan') {
      const dx = e.clientX - S.actStart.sx, dy = e.clientY - S.actStart.sy
      S.panX = S.actStart.px - dx * 6 / S.zoom
      S.panY = S.actStart.py - dy * 6 / S.zoom
      if (!panPending) { panPending = true; requestAnimationFrame(() => { panPending = false; applyViewBox(); renderHandles() }) }
    }
    return
  }
  if (S.act === 'maybe-move') {
    const dx = e.clientX - S.actStart.sx, dy = e.clientY - S.actStart.sy
    if (dx * dx + dy * dy < 25) return
    S.act = 'move'
  }
  if (S.act === 'move' && S.actTarget) {
    const pt = clientToSVG(e)
    const abs = getAbsBounds(S.actTarget)
    if (!abs) return
    let newX = snap(pt.x - S.actOffset.x)
    let newY = snap(pt.y - S.actOffset.y)
    const snapped = snapRectToSiblings(newX, newY, abs.w, abs.h, getSiblings(S.actTarget))
    newX = snapped.x; newY = snapped.y
    setAbsBounds(S.actTarget, newX, newY, abs.w, abs.h)
    updateElementDOM(); renderDetails()
    return
  }

  if (S.act === 'resize' && S.actTarget && S.actOrig) {
    const pt = clientToSVG(e)
    const startSVG = svgEl.createSVGPoint()
    startSVG.x = S.actStart.sx; startSVG.y = S.actStart.sy
    const startPt = startSVG.matrixTransform(svgEl.getScreenCTM().inverse())
    const dx = pt.x - startPt.x
    const dy = pt.y - startPt.y
    let { x, y, w, h } = S.actOrig
    const hPos = S.actHandle
    if (hPos.includes('l')) { x += dx; w -= dx }
    if (hPos.includes('r')) { w += dx }
    if (hPos.includes('t')) { y += dy; h -= dy }
    if (hPos.includes('b')) { h += dy }
    if (hPos === 'ml') { x += dx; w -= dx }
    if (hPos === 'mr') { w += dx }
    if (hPos === 'tm') { y += dy; h -= dy }
    if (hPos === 'bm') { h += dy }
    setAbsBounds(S.actTarget, x, y, w, h)
    updateElementDOM(); renderDetails()
    return
  }

  if (S.act === 'pan') {
    const dx = e.clientX - S.actStart.sx
    const dy = e.clientY - S.actStart.sy
    S.panX = S.actStart.px - dx * 6 / S.zoom
    S.panY = S.actStart.py - dy * 6 / S.zoom
    if (!panPending) {
      panPending = true
      requestAnimationFrame(() => { panPending = false; applyViewBox(); renderHandles() })
    }
    return
  }

  if (S.drawing) {
    if (S.mode === 'hall') {
      S.drawCur = clientToSVG(e); renderCanvas(); return
    }
    if (S.mode === 'section' && S.selectedType === 'hall') {
      const hall = S.halls.find(h => h._id === S.selectedId)
      if (!hall) { S.drawing = false; renderCanvas(); return }
      const raw = clientToSVG(e)
      S.drawCur = {
        x: snap(Math.max(GRID, Math.min(hall.width - GRID, raw.x - hall.x))),
        y: snap(Math.max(GRID * 2, Math.min(hall.height - GRID, raw.y - hall.y))),
      }
      renderCanvas(); return
    }
    if (S.mode === 'stock' && S.selectedType === 'section') {
      const sec = S.sections.find(s => s._id === S.selectedId)
      if (!sec) { S.drawing = false; renderCanvas(); return }
      const hall = S.halls.find(h => h._id === sec.hallId)
      if (!hall) { S.drawing = false; renderCanvas(); return }
      const raw = clientToSVG(e)
      const px = raw.x - (hall.x + sec.x), py = raw.y - (hall.y + sec.y)
      S.drawCur = {
        x: snap(Math.max(GRID, Math.min(sec.width - GRID, px))),
        y: snap(Math.max(GRID, Math.min(sec.height - GRID, py))),
      }
      renderCanvas(); return
    }
  }
}

function updateElementDOM() {
  if (!S.selectedId || !S.selectedType || !svgEl) return
  const el = getSelectedElement()
  if (!el) return
  const g = svgEl.querySelector(`[data-type="${S.selectedType}"][data-id="${S.selectedId}"]`)
  if (!g) return

  const isResize = S.act === 'resize'
  if (S.selectedType === 'hall') {
    g.setAttribute('transform', `translate(${el.x}, ${el.y})`)
    const rect = g.querySelector('rect.wh-hall')
    if (rect) {
      rect.setAttribute('width', el.width); rect.setAttribute('height', el.height)
      if (isResize) {
        rect.setAttribute('stroke', '#1d4ed8'); rect.setAttribute('stroke-width', '6')
      } else {
        rect.setAttribute('stroke', '#3b82f6'); rect.setAttribute('stroke-width', '3')
      }
    }
  } else if (S.selectedType === 'section') {
    g.setAttribute('transform', `translate(${el.x}, ${el.y})`)
    const rect = g.querySelector('rect.wh-section')
    if (rect) {
      rect.setAttribute('width', el.width); rect.setAttribute('height', el.height)
      if (isResize) {
        rect.setAttribute('stroke', '#1d4ed8'); rect.setAttribute('stroke-width', '5')
      } else {
        rect.setAttribute('stroke', '#3b82f6'); rect.setAttribute('stroke-width', '2.5')
      }
    }
  } else if (S.selectedType === 'stock') {
    g.setAttribute('transform', `translate(${el.x}, ${el.y})`)
    const rect = g.querySelector('rect.wh-stock')
    if (rect) {
      rect.setAttribute('width', el.width); rect.setAttribute('height', el.height)
      if (isResize) {
        rect.setAttribute('stroke', '#1d4ed8'); rect.setAttribute('stroke-width', '4')
      } else {
        rect.setAttribute('stroke', '#3b82f6'); rect.setAttribute('stroke-width', '2')
      }
    }
  }

  renderHandles()
}

function onPointerLeave(e) {
  if (S.drawing) { S.drawing = false; renderCanvas() }
  S.act = null
}

async function onPointerUp(e) {
  if (S.act === 'maybe-move') { S.act = null; S.actTarget = null; return }
  if (S.act === 'move' && S.actTarget) {
    S.act = null
    await saveCurrentElement(S.actTarget)
    S.actTarget = null
    await loadData(); renderToolbar(); renderCanvas(); renderDetails()
    return
  }
  if (S.act === 'resize' && S.actTarget) {
    S.act = null
    await saveCurrentElement(S.actTarget)
    S.actTarget = null
    await loadData(); renderToolbar(); renderCanvas(); renderDetails()
    return
  }
  if (S.act === 'pan') { S.act = null; return }

  if (!S.drawing) { S.act = null; return }
  S.drawing = false; S.act = null

  const x = Math.min(S.drawStart.x, S.drawCur.x)
  const y = Math.min(S.drawStart.y, S.drawCur.y)
  const w = Math.abs(S.drawCur.x - S.drawStart.x)
  const hh = Math.abs(S.drawCur.y - S.drawStart.y)
  if (w < GRID || hh < GRID) { renderCanvas(); return }

  if (S.mode === 'hall') {
    const name = prompt('Hall name:')
    if (!name || !name.trim()) { renderCanvas(); return }
    await saveHall({ warehouseId: S.warehouseId, name: name.trim(), x, y, width: w, height: hh, color: '#6366F1' })
    await loadData()
    const created = S.halls.find(h => h.name === name.trim())
    if (created) { S.selectedId = created._id; S.selectedType = 'hall'; S.mode = 'select' }
    renderToolbar(); renderCanvas(); renderDetails(); return
  }

  if (S.mode === 'section' && S.selectedType === 'hall') {
    const hall = S.halls.find(h => h._id === S.selectedId)
    if (!hall) { renderCanvas(); return }
    const name = prompt('Section name:')
    if (!name || !name.trim()) { renderCanvas(); return }
    await saveSection({ hallId: hall._id, name: name.trim(), x, y, width: w, height: hh, color: '#8B5CF6' })
    await loadData()
    const created = S.sections.find(s => s.name === name.trim() && s.hallId === hall._id)
    if (created) { S.selectedId = created._id; S.selectedType = 'section'; S.mode = 'select' }
    renderToolbar(); renderCanvas(); renderDetails(); return
  }

  if (S.mode === 'stock' && S.selectedType === 'section') {
    const sec = S.sections.find(s => s._id === S.selectedId)
    if (!sec) { renderCanvas(); return }
    const partyName = prompt('Party name:')
    if (!partyName || !partyName.trim()) { renderCanvas(); return }
    const itemName = prompt('Item name:')
    if (!itemName || !itemName.trim()) { renderCanvas(); return }
    const qty = parseInt(prompt('Quantity:') || '0') || 0
    await saveStock({ sectionId: sec._id, partyName: partyName.trim(), itemName: itemName.trim(), quantity: qty, x, y, width: w, height: hh })
    await loadData()
    const created = S.stocks.find(st => st.sectionId === sec._id && st.partyName === partyName.trim())
    if (created) { S.selectedId = created._id; S.selectedType = 'stock'; S.mode = 'select' }
    renderToolbar(); renderCanvas(); renderDetails(); return
  }
  renderCanvas()
}

async function saveCurrentElement(el) {
  if (!el) return
  try { await { hall: saveHall, section: saveSection, stock: saveStock }[S.selectedType](el) } catch {}
}

function startDraw(e) {
  if (S.mode === 'hall') {
    S.drawing = true; S.drawStart = clientToSVG(e); S.drawCur = { ...S.drawStart }; renderCanvas(); return
  }
  if (S.mode === 'section' && S.selectedType === 'hall') {
    const hall = S.halls.find(h => h._id === S.selectedId)
    if (!hall) return
    const raw = clientToSVG(e)
    S.drawing = true
    S.drawStart = {
      x: snap(Math.max(GRID, Math.min(hall.width - GRID, raw.x - hall.x))),
      y: snap(Math.max(GRID * 2, Math.min(hall.height - GRID, raw.y - hall.y))),
    }
    S.drawCur = { ...S.drawStart }; renderCanvas(); return
  }
  if (S.mode === 'stock' && S.selectedType === 'section') {
    const sec = S.sections.find(s => s._id === S.selectedId)
    if (!sec) return
    const hall = S.halls.find(h => h._id === sec.hallId)
    if (!hall) return
    const raw = clientToSVG(e)
    const px = raw.x - (hall.x + sec.x), py = raw.y - (hall.y + sec.y)
    S.drawing = true
    S.drawStart = {
      x: snap(Math.max(GRID, Math.min(sec.width - GRID, px))),
      y: snap(Math.max(GRID, Math.min(sec.height - GRID, py))),
    }
    S.drawCur = { ...S.drawStart }; renderCanvas()
  }
}

// ── SELECTION ──

function selectElement(id, type) {
  if (type === 'hall' && !S.halls.find(h => h._id === id)) return
  if (type === 'section' && !S.sections.find(s => s._id === id)) return
  if (type === 'stock' && !S.stocks.find(st => st._id === id)) return
  S.selectedId = id; S.selectedType = type; S.mode = 'select'
  renderToolbar(); renderCanvas(); renderDetails()
}

function clearSelection() {
  S.selectedId = null; S.selectedType = null
  renderToolbar(); renderCanvas(); renderDetails()
}

function getSelectedElement() {
  if (S.selectedType === 'hall') return S.halls.find(h => h._id === S.selectedId)
  if (S.selectedType === 'section') return S.sections.find(s => s._id === S.selectedId)
  if (S.selectedType === 'stock') return S.stocks.find(st => st._id === S.selectedId)
  return null
}

// ── BILLING ──

async function showBilling() {
  try {
    const bills = await getBills(S.warehouseId)
    const parties = await getParties()
    W.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button id="wh-back" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
      <h2 class="text-lg font-bold truncate flex-1 text-center">Billing</h2>
      <button id="wh-new-bill" class="btn-primary text-sm px-3 py-1.5">+ New</button>
    </div>
    <div id="wh-bills-list" class="space-y-1">
      ${bills.length === 0 ? '<p class="text-sm text-gray-400 text-center py-8">No bills yet.</p>' :
        bills.map(b => `
          <div class="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-sm truncate">${esc(b.partyName)}</div>
              <div class="text-xs text-gray-400 mt-0.5">₹${b.totalAmount} · ${b.status}</div>
            </div>
            <span class="text-xs px-2 py-0.5 rounded-full ${b.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">${b.status}</span>
          </div>`).join('')}
    </div>`
  document.getElementById('wh-back').addEventListener('click', () => showCanvas(S.warehouseId))
  document.getElementById('wh-new-bill').addEventListener('click', () => showBillForm())
  } catch (e) { console.error('Billing error:', e); showToast('Failed to load billing'); }
}

async function showBillForm() {
  const parties = await getParties()
  const stocks = await getStocksByWarehouse(S.warehouseId)
  W.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button id="wh-back" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
      <h2 class="text-lg font-bold truncate flex-1 text-center">New Bill</h2>
      <button id="wh-save-bill" class="text-sm font-semibold text-primary">Save</button>
    </div>
    <div class="space-y-3">${[
      ['Party', 'wh-bill-party', `<option value="">Select party...</option>${parties.map(p => `<option value="${p._id}">${esc(p.name || p.partyName || '')}</option>`).join('')}`, 'select'],
      ['Item & Quantity', 'wh-bill-stock', `<option value="">Select stock...</option>${stocks.map(s => `<option value="${s._id}">${esc(s.partyName)} — ${esc(s.itemName)} (${s.quantity})</option>`).join('')}`, 'select'],
    ].map(([label, id, opts]) =>
      `<div><label class="input-label">${label}</label><select id="${id}" class="input">${opts}</select></div>`
    ).join('')}
      <div class="grid grid-cols-2 gap-3">
        <div><label class="input-label">Rate (per unit)</label><input id="wh-bill-rate" class="input" type="number" step="0.01" min="0" placeholder="0"></div>
        <div><label class="input-label">Period</label><input id="wh-bill-period" class="input" placeholder="e.g. Mar 2024"></div>
      </div>
      <div><label class="input-label">Total Amount</label><input id="wh-bill-amount" class="input" type="number" step="0.01" min="0" placeholder="0" readonly></div>
      <div><label class="input-label">Status</label><select id="wh-bill-status" class="input"><option value="pending">Pending</option><option value="paid">Paid</option></select></div>
    </div>`
  document.getElementById('wh-back').addEventListener('click', () => showBilling())
  document.getElementById('wh-save-bill').addEventListener('click', async () => {
    const partyId = document.getElementById('wh-bill-party').value
    const stockId = document.getElementById('wh-bill-stock').value
    const rate = parseFloat(document.getElementById('wh-bill-rate').value) || 0
    const period = document.getElementById('wh-bill-period').value.trim()
    const status = document.getElementById('wh-bill-status').value
    const stock = stocks.find(s => s._id === stockId)
    if (!partyId || !stockId) { showToast('Select party and stock'); return }
    const totalAmount = rate * stock.quantity
    const party = parties.find(p => p._id === partyId)
    await saveBill({ warehouseId: S.warehouseId, partyId, partyName: party?.name || party?.partyName || '', stockId, itemName: stock.itemName, quantity: stock.quantity, rate, period, totalAmount, status })
    showToast('Bill saved'); await showBilling()
  })
  const rateInput = document.getElementById('wh-bill-rate')
  const stockSelect = document.getElementById('wh-bill-stock')
  function calcAmount() {
    const rate = parseFloat(rateInput.value) || 0
    const stock = stocks.find(s => s._id === stockSelect.value)
    document.getElementById('wh-bill-amount').value = rate * (stock?.quantity || 0)
  }
  rateInput.addEventListener('input', calcAmount)
  stockSelect.addEventListener('change', calcAmount)
}
