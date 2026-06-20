import { renderHeader } from '../components/Header.js'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('calc_history') || '[]') } catch { return [] }
}

function saveHistoryItem(expr, result) {
  const h = loadHistory()
  h.unshift({ expr, result, ts: Date.now() })
  if (h.length > 50) h.length = 50
  localStorage.setItem('calc_history', JSON.stringify(h))
  return h
}

export function renderCalculator(main, navigate) {
  renderHeader('Calculator')

  main.innerHTML = `
    <div class="max-w-xs mx-auto mt-4">
      <div id="gt-bar" class="hidden mb-1 px-3 py-1 bg-primary/10 rounded-lg flex items-center justify-between">
        <span class="text-xs text-gray-500">Grand Total (<span id="gt-count-label">0</span>)</span>
        <span class="text-sm font-bold text-primary tabular-nums" id="gt-result">0</span>
      </div>
      <div class="bg-white rounded-2xl shadow-lg p-4">
        <div class="mb-3 px-2">
          <div id="calc-formula" class="text-right text-sm text-gray-400 h-5 overflow-hidden"></div>
          <div id="calc-display" class="text-right text-4xl font-bold text-gray-900 h-12 overflow-hidden tabular-nums">0</div>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <button class="calc-btn bg-gray-100 text-gray-700" data-action="clear">C</button>
          <button class="calc-btn bg-gray-100 text-gray-700" data-action="negate">±</button>
          <button class="calc-btn bg-gray-100 text-gray-700" data-action="percent">%</button>
          <button class="calc-btn bg-amber-100 text-amber-700" data-action="divide">÷</button>

          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">7</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">8</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">9</button>
          <button class="calc-btn bg-amber-100 text-amber-700" data-action="multiply">×</button>

          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">4</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">5</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">6</button>
          <button class="calc-btn bg-amber-100 text-amber-700" data-action="subtract">−</button>

          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">1</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">2</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="digit">3</button>
          <button class="calc-btn bg-amber-100 text-amber-700" data-action="add">+</button>

          <button class="calc-btn bg-gray-50 text-gray-900 col-span-2" data-action="digit">0</button>
          <button class="calc-btn bg-gray-50 text-gray-900" data-action="decimal">.</button>
          <button class="calc-btn bg-primary text-white" data-action="equals">=</button>
        </div>
      </div>

      <div class="mt-6">
        <div class="flex items-center justify-between mb-2">
          <label class="flex items-center gap-2 cursor-pointer" id="select-all-label">
            <input type="checkbox" id="select-all-check" class="rounded border-gray-300 text-primary focus:ring-primary">
            <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">History</span>
          </label>
          <div class="flex items-center gap-2">
            <button id="ac-btn" class="px-3 py-1 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 active:bg-red-700">AC</button>
            <button id="gt-btn" class="px-3 py-1 text-xs font-bold text-white bg-primary rounded-lg hover:bg-primary/90 active:bg-primary/80 disabled:opacity-30 disabled:cursor-not-allowed" disabled>GT</button>
          </div>
        </div>
        <div id="calc-history" class="max-h-64 overflow-y-auto space-y-0.5"></div>
      </div>
    </div>
  `

  const state = { display: '0', operator: null, prev: null, reset: false }
  let currentExpr = ''
  let selectedGT = new Set()
  let history = loadHistory()

  const displayEl = document.getElementById('calc-display')
  const formulaEl = document.getElementById('calc-formula')
  const historyEl = document.getElementById('calc-history')
  const gtBtn = document.getElementById('gt-btn')
  const gtBar = document.getElementById('gt-bar')
  const gtCountLabel = document.getElementById('gt-count-label')
  const gtResult = document.getElementById('gt-result')
  const selectAllCheck = document.getElementById('select-all-check')

  function updateDisplay() { displayEl.textContent = state.display || '0' }

  function formatResult(n) {
    if (!isFinite(n)) return 'Error'
    return parseFloat(n.toFixed(2)).toString()
  }

  function appendDigit(d) {
    if (state.reset) {
      state.display = d
      currentExpr = currentExpr.replace(/\s*$/, '') + ' ' + d
      state.reset = false
    } else {
      state.display = state.display === '0' ? d : state.display + d
      currentExpr += d
    }
  }

  function inputDecimal() {
    if (state.reset) {
      state.display = '0.'
      currentExpr += ' 0.'
      state.reset = false
      return
    }
    if (!state.display.includes('.')) { state.display += '.'; currentExpr += '.' }
  }

  function compute(a, op, b) {
    const n1 = parseFloat(a), n2 = parseFloat(b)
    switch (op) {
      case 'add': return n1 + n2
      case 'subtract': return n1 - n2
      case 'multiply': return n1 * n2
      case 'divide': return n2 !== 0 ? n1 / n2 : NaN
      default: return n2
    }
  }

  const SYM = { add: '+', subtract: '−', multiply: '×', divide: '÷' }

  function handleOperator(op) {
    if (state.operator && !state.reset) {
      const result = compute(state.prev, state.operator, state.display)
      if (!isFinite(result)) { state.display = 'Error'; updateDisplay(); return }
      const formatted = formatResult(result)
      state.display = formatted
      state.prev = formatted
      currentExpr = formatted
    }
    state.operator = op
    state.prev = state.display
    state.reset = true
    currentExpr = state.display + ' ' + SYM[op]
    formulaEl.textContent = currentExpr
  }

  function handleEquals() {
    if (!state.operator) return
    const result = compute(state.prev, state.operator, state.display)
    if (!isFinite(result)) { state.display = 'Error'; updateDisplay(); return }
    const formatted = formatResult(result)
    let saveExpr = currentExpr
    if (state.reset) {
      saveExpr = (state.prev || '0') + ' ' + SYM[state.operator] + ' ' + state.display
    }
    const fullExpr = saveExpr + ' = ' + formatted
    formulaEl.textContent = fullExpr
    state.display = formatted
    state.operator = null
    state.prev = null
    state.reset = true
    history = saveHistoryItem(saveExpr, parseFloat(formatted))
    currentExpr = formatted
    updateDisplay()
    renderHistory()
  }

  function clearAll() {
    state.display = '0'; state.operator = null; state.prev = null; state.reset = false
    currentExpr = ''; formulaEl.textContent = ''; updateDisplay()
  }

  function backspace() {
    if (state.reset) return
    state.display = state.display.length > 1 ? state.display.slice(0, -1) : '0'
    currentExpr = currentExpr.length > 0 ? currentExpr.slice(0, -1) : ''
  }

  function negate() {
    if (state.display !== '0') {
      state.display = state.display.startsWith('-') ? state.display.slice(1) : '-' + state.display
      currentExpr = state.display === '0' ? '' : state.display
    }
  }

  function percent() {
    state.display = formatResult(parseFloat(state.display) / 100)
    currentExpr = state.display
  }

  function writeHistoryItem(item) {
    const label = document.createElement('label')
    label.className = 'flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm'
    label.dataset.ts = item.ts
    const checked = selectedGT.has(item.ts)
    label.innerHTML = `
      <input type="checkbox" class="gt-check rounded border-gray-300 text-primary focus:ring-primary" ${checked ? 'checked' : ''}>
      <span class="flex-1 text-gray-700 text-xs leading-relaxed">${escHtml(item.expr)}</span>
      <span class="font-semibold text-gray-900 tabular-nums text-sm">${escHtml(formatResult(item.result))}</span>
    `
    label.querySelector('.gt-check').addEventListener('change', (e) => {
      if (e.target.checked) selectedGT.add(item.ts)
      else selectedGT.delete(item.ts)
      updateGT()
    })
    return label
  }

  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  function renderHistory() {
    historyEl.innerHTML = ''
    history.forEach(item => historyEl.appendChild(writeHistoryItem(item)))
    selectAllCheck.checked = history.length > 0 && selectedGT.size === history.length
  }

  function updateGT() {
    const count = selectedGT.size
    gtBtn.disabled = count === 0
    if (count > 0) {
      const total = history.filter(h => selectedGT.has(h.ts)).reduce((sum, h) => sum + h.result, 0)
      gtBar.classList.remove('hidden')
      gtCountLabel.textContent = count
      gtResult.textContent = formatResult(total)
    } else {
      gtBar.classList.add('hidden')
    }
    selectAllCheck.checked = history.length > 0 && selectedGT.size === history.length
  }

  main.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action
      if (action === 'digit') appendDigit(btn.textContent)
      else if (action === 'decimal') inputDecimal()
      else if (action === 'clear') clearAll()
      else if (action === 'negate') negate()
      else if (action === 'percent') percent()
      else if (action === 'equals') handleEquals()
      else if (['add', 'subtract', 'multiply', 'divide'].includes(action)) handleOperator(action)
      updateDisplay()
    })
  })

  gtBtn.addEventListener('click', () => {
    if (selectedGT.size === 0) return
    const total = history.filter(h => selectedGT.has(h.ts)).reduce((sum, h) => sum + h.result, 0)
    state.display = formatResult(total)
    state.operator = null; state.prev = null; state.reset = true
    currentExpr = ''
    formulaEl.textContent = ''
    updateDisplay()
  })

  selectAllCheck.addEventListener('change', (e) => {
    if (e.target.checked) {
      history.forEach(h => selectedGT.add(h.ts))
    } else {
      selectedGT.clear()
    }
    renderHistory()
    updateGT()
  })

  document.getElementById('ac-btn').addEventListener('click', () => {
    clearAll()
    selectedGT.clear()
    localStorage.removeItem('calc_history')
    history = []
    renderHistory()
    updateGT()
  })

  renderHistory()
  updateDisplay()
}
