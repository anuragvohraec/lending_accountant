import { getAllTodos, saveTodo, deleteTodo } from '../db/database.js'
import { escHtml } from '../utils/helpers.js'
import { showToast } from '../components/Toast.js'
import { showConfirm } from '../components/Modal.js'
import { logAction } from '../services/audit.js'
import { renderHeader } from '../components/Header.js'

function onDoubleTap(el, fn) {
  let lastTouch = 0
  el.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouch < 350) { e.preventDefault(); fn() }
    lastTouch = now
  }, { passive: false })
  el.addEventListener('dblclick', (e) => { e.preventDefault(); fn() })
}

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function fmtDate(iso) {
  if (!iso) return '-'
  const p = iso.slice(0, 10).split('-')
  return p[2] + '/' + p[1] + '/' + p[0].slice(-2)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const COLORS = [
  { value: 'red', dot: 'bg-red-400' },
  { value: 'yellow', dot: 'bg-yellow-400' },
  { value: 'green', dot: 'bg-green-400' },
  { value: '', dot: 'bg-gray-300 border-2 border-gray-400' },
]

function headerBg(color) {
  return color === 'red' ? 'bg-red-100/80'
    : color === 'yellow' ? 'bg-yellow-100/80'
    : color === 'green' ? 'bg-green-100/80'
    : 'bg-gray-50/80'
}

function dotClass(color) {
  const c = COLORS.find(c => c.value === (color || ''))
  return c ? c.dot : 'bg-gray-300 border-2 border-gray-400'
}

function renderTodoCard(t) {
  const cd = t.createdAt
    ? new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : ''
  const dateStr = t.targetDate
    ? new Date(t.targetDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '-'
  return `
    <div class="card !p-0 todo-item ${t.status === 'closed' ? 'opacity-50' : ''}" data-id="${t._id}">
      <div class="flex items-center justify-between gap-2 px-2.5 py-1 ${headerBg(t.color)} rounded-t-xl">
        <button class="todo-delete p-1 rounded-lg text-gray-300 hover:text-red-400" data-id="${t._id}">
          <ion-icon name="trash-outline" class="text-base"></ion-icon>
        </button>
        <div class="todo-target-date text-[11px] font-medium text-center leading-tight text-primary">
          ${dateStr}
        </div>
        <button class="todo-toggle p-1 rounded-lg ${t.status === 'closed' ? 'text-green-500' : 'text-gray-300 hover:text-green-500'}" data-id="${t._id}">
          <ion-icon name="${t.status === 'closed' ? 'checkmark-circle' : 'checkmark-circle-outline'}" class="text-lg"></ion-icon>
        </button>
      </div>
      <div class="px-2.5 py-2">
        <div class="todo-note text-sm whitespace-pre-wrap break-words text-gray-700">${escHtml(t.note || '')}</div>
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[10px] text-gray-400">${cd}</span>
          <div class="relative">
            <button class="todo-color-trigger w-4 h-4 rounded-full ${dotClass(t.color)}" data-id="${t._id}"></button>
            <div class="todo-color-popover hidden absolute bottom-full right-0 mb-1 p-1.5 bg-white rounded-lg shadow-xl border border-gray-200 flex gap-1 z-50" id="pop-${t._id}" data-pid="${t._id}">
              ${COLORS.map(c => {
                const active = (t.color || '') === c.value
                return `<button class="todo-color-opt w-4 h-4 rounded-full ${c.dot} flex-shrink-0 ${active ? 'ring-2 ring-offset-1 ring-primary' : ''}" data-id="${t._id}" data-color="${c.value}"></button>`
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}

export async function renderCalendar(container, navigate) {
  renderHeader('Calendar')

  let currentYear = new Date().getFullYear()
  let currentMonth = new Date().getMonth()
  let selectedDate = null
  let todos = await getAllTodos()

  const years = []
  for (let y = currentYear - 10; y <= currentYear + 10; y++) years.push(y)

  function render() {
    const firstDay = new Date(currentYear, currentMonth, 1)
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

    let startDow = firstDay.getDay()
    startDow = startDow === 0 ? 6 : startDow - 1

    const dateStr = (y, m, d) =>
      `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

    const openTodos = todos.filter(t => t.status !== 'closed')
    const todosByDate = {}
    for (const t of openTodos) {
      if (t.targetDate) {
        if (!todosByDate[t.targetDate]) todosByDate[t.targetDate] = []
        todosByDate[t.targetDate].push(t)
      }
    }

    let cells = ''
    for (let i = 0; i < startDow; i++) {
      cells += '<div></div>'
    }
    const today = new Date()
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = dateStr(currentYear, currentMonth, d)
      const isToday = d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()
      const hasTodos = !!(todosByDate[ds] && todosByDate[ds].length > 0)
      const isSel = selectedDate === ds

      let cls = 'h-9 flex items-center justify-center relative cursor-pointer rounded-lg text-sm font-medium select-none'
      if (isToday) cls += ' bg-primary text-white'
      else if (isSel) cls += ' bg-indigo-100'
      else cls += ' hover:bg-gray-100'

      const ring = hasTodos ? ' ring-2 ring-red-400 ring-offset-1' : ''
      cells += `<div class="${cls}" data-date="${ds}">
        <span class="z-10${ring} rounded-full w-7 h-7 flex items-center justify-center">${d}</span>
      </div>`
    }

    container.innerHTML = `
      <div class="slide-up p-4">
        <div class="flex items-center justify-between mb-4">
          <button class="btn-icon btn-ghost" id="cal-prev"><ion-icon name="chevron-back-outline" class="text-xl"></ion-icon></button>
          <div class="flex items-center gap-2">
            <select id="cal-month" class="text-sm font-semibold border-none bg-transparent cursor-pointer outline-none">
              ${MONTHS.map((m, i) => `<option value="${i}" ${i === currentMonth ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            <select id="cal-year" class="text-sm font-semibold border-none bg-transparent cursor-pointer outline-none">
              ${years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <button class="btn-icon btn-ghost" id="cal-next"><ion-icon name="chevron-forward-outline" class="text-xl"></ion-icon></button>
        </div>
        <div class="grid grid-cols-7 gap-0.5 mb-1">
          ${DAYS.map(d => `<div class="text-center text-[11px] font-semibold text-gray-400 uppercase py-1">${d}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-0.5">
          ${cells}
        </div>
        <div id="cal-selected" class="mt-4"></div>
      </div>
    `

    document.getElementById('cal-prev').addEventListener('click', () => {
      currentMonth--
      if (currentMonth < 0) { currentMonth = 11; currentYear-- }
      selectedDate = null
      render()
    })
    document.getElementById('cal-next').addEventListener('click', () => {
      currentMonth++
      if (currentMonth > 11) { currentMonth = 0; currentYear++ }
      selectedDate = null
      render()
    })
    document.getElementById('cal-month').addEventListener('change', (e) => {
      currentMonth = parseInt(e.target.value)
      selectedDate = null
      render()
    })
    document.getElementById('cal-year').addEventListener('change', (e) => {
      currentYear = parseInt(e.target.value)
      selectedDate = null
      render()
    })

    // Today button via header
    document.querySelectorAll('[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        selectedDate = el.dataset.date
        render()
      })
    })

    if (selectedDate) renderDateTodos()
  }

  async function renderDateTodos() {
    const el = document.getElementById('cal-selected')
    if (!el) return

    const dayTodos = todos.filter(t => t.status !== 'closed' && t.targetDate === selectedDate)
    const dateObj = new Date(selectedDate + 'T00:00:00')
    const formatted = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

    el.innerHTML = `
      <div class="border-t border-gray-200 pt-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold">${escHtml(formatted)}</span>
          <button class="text-xs text-primary font-medium flex items-center gap-1" id="cal-add-todo"><ion-icon name="add-circle-outline"></ion-icon> Add ToDo</button>
        </div>
        ${dayTodos.length === 0 ? '<p class="text-xs text-gray-400 text-center py-3">No open tasks for this date</p>' : ''}
        <div class="space-y-2">
          ${dayTodos.map(renderTodoCard).join('')}
        </div>
      </div>
    `

    document.getElementById('cal-add-todo')?.addEventListener('click', async () => {
      await saveTodo({ note: 'New todo', targetDate: selectedDate, status: 'open', color: '' })
      todos = await getAllTodos()
      logAction('create', 'todo', '', `Created todo for ${selectedDate}`)
      showToast('ToDo added')
      render()
    })

    el.querySelectorAll('.todo-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const todo = todos.find(t => t._id === btn.dataset.id)
        if (!todo) return
        todo.status = todo.status === 'closed' ? 'open' : 'closed'
        await saveTodo(todo)
        todos = await getAllTodos()
        render()
      })
    })

    el.querySelectorAll('.todo-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ok = await showConfirm({ title: 'Delete?', message: 'Remove this todo?', confirmText: 'Delete', danger: true })
        if (!ok) return
        await deleteTodo(btn.dataset.id)
        todos = await getAllTodos()
        logAction('delete', 'todo', btn.dataset.id, 'Deleted todo from calendar')
        showToast('ToDo deleted')
        render()
      })
    })

    el.querySelectorAll('.todo-color-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        document.querySelectorAll('.todo-color-popover').forEach(p => {
          if (p.dataset.pid !== btn.dataset.id) p.classList.add('hidden')
        })
        const pop = document.getElementById('pop-' + btn.dataset.id)
        if (pop) pop.classList.toggle('hidden')
      })
    })

    el.querySelectorAll('.todo-color-opt').forEach(btn => {
      btn.addEventListener('click', async () => {
        const todo = todos.find(t => t._id === btn.dataset.id)
        if (!todo) return
        todo.color = btn.dataset.color
        await saveTodo(todo)
        todos = await getAllTodos()
        render()
      })
    })

    el.querySelectorAll('.todo-target-date').forEach(targetEl => {
      onDoubleTap(targetEl, () => {
        const item = todos.find(t => t._id === targetEl.closest('.todo-item').dataset.id)
        if (!item) return
        const currentFmt = item.targetDate ? fmtDate(item.targetDate) : fmtDate(todayISO())
        const currentIso = item.targetDate || todayISO()

        targetEl.innerHTML = `
          <div class="flex items-center gap-1">
            <input type="text" class="input text-xs py-0.5 px-1 w-24 text-center target-date-text" value="${currentFmt}" inputmode="numeric" autocomplete="off">
            <input type="date" class="target-date-native hidden" value="${currentIso}">
            <button class="target-date-picker text-gray-500 p-0.5 shrink-0" title="Pick date">
              <ion-icon name="calendar-outline" class="text-sm"></ion-icon>
            </button>
          </div>
        `

        const textInput = targetEl.querySelector('.target-date-text')
        const native = targetEl.querySelector('.target-date-native')
        const pickerBtn = targetEl.querySelector('.target-date-picker')

        textInput.focus()
        textInput.select()

        function parseDate(str) {
          const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})?(\d{2})$/)
          if (!m) return null
          let dd = parseInt(m[1]), mm = parseInt(m[2]), yy = m[4] || m[3]
          if (yy.length === 2) yy = '20' + yy
          if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
          return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0')
        }

        function fmtToDisplay(iso) {
          if (!iso) return ''
          const p = iso.slice(0, 10).split('-')
          return p[2] + '/' + p[1] + '/' + p[0].slice(-2)
        }

        function commit(val) {
          const parsed = val || textInput.value
          const iso = parseDate(parsed)
          item.targetDate = iso || todayISO()
          item.updatedAt = new Date().toISOString()
          saveTodo(item)
          todos = [...todos]
          render()
        }

        textInput.addEventListener('blur', () => commit(null))
        textInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') textInput.blur()
          if (e.key === 'Escape') { textInput.value = currentFmt; textInput.blur() }
        })

        native.addEventListener('change', () => {
          if (native.value) {
            textInput.value = fmtToDisplay(native.value)
            commit(native.value)
          }
        })

        pickerBtn.addEventListener('click', () => {
          native.showPicker ? native.showPicker() : native.click()
        })
      })
    })

    el.querySelectorAll('.todo-note').forEach(noteEl => {
      onDoubleTap(noteEl, () => {
        if (noteEl.contentEditable === 'true') return
        const item = todos.find(t => t._id === noteEl.closest('.todo-item').dataset.id)
        if (!item) return
        const originalText = item.note || ''
        let editing = true

        noteEl.contentEditable = 'true'
        noteEl.classList.remove('cursor-pointer', 'select-none')
        noteEl.focus()

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-100 text-red-500 hover:bg-red-200 leading-none shadow-sm z-10'
        cancelBtn.innerHTML = '<ion-icon name="close-outline" class="text-sm"></ion-icon>'
        cancelBtn.title = 'Cancel edits'
        noteEl.style.position = 'relative'
        noteEl.appendChild(cancelBtn)

        function clearEditUI() {
          if (!editing) return
          editing = false
          if (cancelBtn.parentNode) cancelBtn.remove()
          noteEl.style.position = ''
          noteEl.contentEditable = 'false'
          noteEl.classList.add('cursor-pointer', 'select-none')
          document.removeEventListener('click', docHandler, true)
        }

        function docHandler(e) {
          if (noteEl.contains(e.target) || cancelBtn.contains(e.target)) return
          const val = noteEl.innerText.trim()
          if (val && val !== originalText) {
            item.note = val
            item.updatedAt = new Date().toISOString()
            saveTodo(item)
            logAction('update', 'todo', item._id, `Edited todo: ${val.slice(0, 50)}`)
            showToast('ToDo updated')
          }
          clearEditUI()
        }
        document.addEventListener('click', docHandler, true)

        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          noteEl.textContent = originalText
          clearEditUI()
        })

        noteEl.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            noteEl.textContent = originalText
            clearEditUI()
          }
        })
      })
    })
  }

  // Close color popovers on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.todo-color-popover').forEach(p => p.classList.add('hidden'))
  }, { passive: true })

  render()
}
