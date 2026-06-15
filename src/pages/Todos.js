import { renderHeader } from '../components/Header.js'
import { getAllTodos, saveTodo, deleteTodo } from '../db/database.js'
import { showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { logAction } from '../services/audit.js'

function onDoubleTap(el, fn) {
  let lastTouch = 0
  el.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouch < 350 && lastTouch > 0) {
      e.preventDefault()
      fn(e)
    }
    lastTouch = now
  }, { passive: false })
  el.addEventListener('dblclick', fn)
}

function escHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function fmtDate(iso) {
  if (!iso) return ''
  const parts = iso.slice(0, 10).split('-')
  return parts[2] + '/' + parts[1] + '/' + parts[0].slice(-2)
}

const COLORS = [
  { value: 'red', label: 'Red', dot: 'bg-red-400' },
  { value: 'yellow', label: 'Yellow', dot: 'bg-yellow-400' },
  { value: 'green', label: 'Green', dot: 'bg-green-400' },
  { value: '', label: 'None', dot: 'bg-gray-300 border-2 border-gray-400' },
]

function headerBg(color) {
  return color === 'red' ? 'bg-red-100/80'
    : color === 'yellow' ? 'bg-yellow-100/80'
    : color === 'green' ? 'bg-green-100/80'
    : 'bg-gray-50/80'
}

export async function renderTodos(container, navigate) {
  renderHeader('ToDo')

  container.innerHTML = `
    <div class="px-4 pb-24">
      <div class="flex items-center gap-1.5 mb-2">
        <div class="flex-1">
          <input class="input text-xs !py-1.5 w-full" id="todo-search" placeholder="Search notes">
        </div>
        <div class="relative">
          <button class="p-1.5 rounded-lg text-gray-400 hover:text-primary transition-colors" id="todo-sort-btn" title="Sort">
            <ion-icon name="funnel-outline" class="text-lg"></ion-icon>
          </button>
          <div id="todo-sort-popover" class="hidden absolute top-full right-0 mt-1 py-1 bg-white rounded-lg shadow-xl border border-gray-200 z-50 min-w-[130px]">
            <button class="todo-sort-opt w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50" data-sort="updated">Last updated</button>
            <button class="todo-sort-opt w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50" data-sort="color">Color</button>
            <button class="todo-sort-opt w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50" data-sort="target">Target date</button>
          </div>
        </div>
        <button class="p-1.5 rounded-lg text-gray-400 hover:text-primary transition-colors" id="todo-show-closed" title="Include closed">
          <ion-icon name="archive-outline" class="text-lg"></ion-icon>
        </button>
      </div>
      <div id="todo-list" class="space-y-2"></div>
    </div>
  `

  let todos = await getAllTodos()
  let currentSort = 'updated'

  function sortTodos() {
    const mode = currentSort
    todos.sort((a, b) => {
      if (mode === 'color') {
        const order = ['red', 'yellow', 'green', '']
        return order.indexOf(a.color || '') - order.indexOf(b.color || '')
      }
      if (mode === 'target') {
        if (!a.targetDate && !b.targetDate) return 0
        if (!a.targetDate) return 1
        if (!b.targetDate) return -1
        return a.targetDate.localeCompare(b.targetDate)
      }
      const au = a.updatedAt || a.createdAt
      const bu = b.updatedAt || b.createdAt
      return new Date(bu) - new Date(au)
    })
  }

  sortTodos()

  let openColorPopover = null
  document.addEventListener('click', (e) => {
    if (!openColorPopover) return
    const { trigger, popover } = openColorPopover
    if (!trigger.parentNode.contains(e.target)) {
      popover.classList.add('hidden')
      openColorPopover = null
    }
  })

  const todoList = document.getElementById('todo-list')
  todoList.addEventListener('click', async (e) => {
    const opt = e.target.closest('.todo-color-opt')
    if (opt) {
      e.stopPropagation()
      const item = todos.find(t => t._id === opt.closest('.todo-item').dataset.id)
      if (!item) return
      const color = opt.dataset.color
      if ((item.color || '') === color) return
      item.color = color || ''
      item.updatedAt = new Date().toISOString()
      await saveTodo(item)
      sortTodos()
      renderList()
      return
    }

    const trig = e.target.closest('.todo-color-trigger')
    if (trig) {
      e.stopPropagation()
      const item = todos.find(t => t._id === trig.closest('.todo-item').dataset.id)
      if (!item) return
      const popover = trig.parentNode.querySelector('.todo-color-popover')
      if (!popover.classList.contains('hidden')) {
        popover.classList.add('hidden')
        if (openColorPopover?.popover === popover) openColorPopover = null
        return
      }
      document.querySelectorAll('.todo-color-popover:not(.hidden)').forEach(p => p.classList.add('hidden'))
      popover.querySelectorAll('.todo-color-opt').forEach(opt => {
        const active = (item.color || '') === opt.dataset.color
        opt.classList.toggle('ring-2', active)
        opt.classList.toggle('ring-offset-1', active)
        opt.classList.toggle('ring-primary', active)
      })
      popover.classList.remove('hidden')
      openColorPopover = { trigger: trig, popover }
      return
    }
  })

  function renderList() {
    const searchVal = document.getElementById('todo-search').value
    const showClosed = document.getElementById('todo-show-closed').dataset.showClosed === 'true'
    const el = document.getElementById('todo-list')

    let filtered = todos
    if (searchVal) {
      try {
        const re = new RegExp(searchVal, 'gi')
        filtered = filtered.filter(t => re.test(t.note || ''))
      } catch {
        filtered = filtered.filter(t => (t.note || '').toLowerCase().includes(searchVal.toLowerCase()))
      }
    }
    if (!showClosed) filtered = filtered.filter(t => t.status !== 'closed')

    if (filtered.length === 0) {
      el.innerHTML = '<p class="text-xs text-gray-400 text-center py-8">No todos found</p>'
      return
    }

    el.innerHTML = filtered.map(t => {
      const created = new Date(t.createdAt)
      const cd = String(created.getDate()).padStart(2, '0') + '/' + String(created.getMonth() + 1).padStart(2, '0') + '/' + String(created.getFullYear()).slice(-2)
      const cc = t.color || ''
      const dotClass = cc === 'red' ? 'bg-red-400'
        : cc === 'yellow' ? 'bg-yellow-400'
        : cc === 'green' ? 'bg-green-400'
        : 'bg-gray-300 border-2 border-gray-400'
      return `
        <div class="card !p-0 todo-item ${t.status === 'closed' ? 'opacity-50' : ''}" data-id="${t._id}">
          <div class="flex items-center justify-between gap-2 px-2.5 py-1 ${headerBg(t.color)} rounded-t-xl">
            <button class="todo-delete p-1 rounded-lg text-gray-300 hover:text-red-400" title="Delete">
              <ion-icon name="trash-outline" class="text-base"></ion-icon>
            </button>
            <div class="todo-target-date text-[11px] font-medium text-center cursor-pointer leading-tight text-primary" data-id="${t._id}">
              ${fmtDate(t.targetDate || todayISO())}
            </div>
            <button class="todo-toggle p-1 rounded-lg ${t.status === 'closed' ? 'text-green-500' : 'text-gray-300 hover:text-green-500'}" title="Toggle status">
              <ion-icon name="${t.status === 'closed' ? 'checkmark-circle' : 'checkmark-circle-outline'}" class="text-lg"></ion-icon>
            </button>
          </div>
          <div class="px-2.5 py-2">
            <div class="todo-note text-sm whitespace-pre-wrap break-words text-gray-700 cursor-pointer select-none">${escHtml(t.note || '')}</div>
            <div class="flex items-center justify-between mt-1.5">
              <span class="text-[10px] text-gray-400">${cd}</span>
              <div class="relative">
                <button class="todo-color-trigger w-4 h-4 rounded-full ${dotClass}"></button>
                <div class="todo-color-popover hidden absolute bottom-full right-0 mb-1 p-1.5 bg-white rounded-lg shadow-xl border border-gray-200 flex gap-1 z-50">
                  ${COLORS.map(c => {
                    const active = (t.color || '') === c.value
                    return `<button class="todo-color-opt w-4 h-4 rounded-full ${c.dot} flex-shrink-0 ${active ? 'ring-2 ring-offset-1 ring-primary' : ''}" data-color="${c.value}" title="${c.label}"></button>`
                  }).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
      `
    }).join('')

    el.querySelectorAll('.todo-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = todos.find(t => t._id === btn.closest('.todo-item').dataset.id)
        if (!item) return
        item.status = item.status === 'closed' ? 'open' : 'closed'
        item.updatedAt = new Date().toISOString()
        await saveTodo(item)
        logAction(item.status === 'closed' ? 'close' : 'reopen', 'todo', item._id, `${item.status === 'closed' ? 'Closed' : 'Reopened'} todo: ${(item.note || '').slice(0, 50)}`)
        showToast(item.status === 'closed' ? 'ToDo closed' : 'ToDo reopened')
        renderList()
      })
    })

    el.querySelectorAll('.todo-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = todos.find(t => t._id === btn.closest('.todo-item').dataset.id)
        if (!item) return
        const confirmed = await showConfirm({ title: 'Delete ToDo?', message: 'Delete this todo permanently?', confirmText: 'Delete', danger: true })
        if (!confirmed) return
        await deleteTodo(item._id)
        logAction('delete', 'todo', item._id, `Deleted todo: ${(item.note || '').slice(0, 50)}`)
        todos = todos.filter(t => t._id !== item._id)
        renderList()
      })
    })

    el.querySelectorAll('.todo-target-date').forEach(el => {
      onDoubleTap(el, () => {
        const item = todos.find(t => t._id === el.dataset.id)
        if (!item) return
        const currentFmt = item.targetDate ? fmtDate(item.targetDate) : fmtDate(todayISO())
        const currentIso = item.targetDate || todayISO()

        el.innerHTML = `
          <div class="flex items-center gap-1">
            <input type="text" class="input text-xs py-0.5 px-1 w-24 text-center target-date-text" value="${currentFmt}" inputmode="numeric" autocomplete="off">
            <input type="date" class="target-date-native hidden" value="${currentIso}">
            <button class="target-date-picker text-gray-500 p-0.5 shrink-0" title="Pick date">
              <ion-icon name="calendar-outline" class="text-sm"></ion-icon>
            </button>
          </div>
        `

        const textInput = el.querySelector('.target-date-text')
        const native = el.querySelector('.target-date-native')
        const pickerBtn = el.querySelector('.target-date-picker')

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
          sortTodos()
          renderList()
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
          const val = noteEl.textContent.trim()
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

  document.getElementById('todo-search').addEventListener('input', renderList)
  document.getElementById('todo-show-closed').addEventListener('click', (e) => {
    const btn = e.currentTarget
    const isActive = btn.dataset.showClosed === 'true'
    btn.dataset.showClosed = isActive ? 'false' : 'true'
    btn.classList.toggle('text-primary', !isActive)
    renderList()
  })
  document.getElementById('todo-sort-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    const popover = document.getElementById('todo-sort-popover')
    const isHidden = popover.classList.contains('hidden')
    if (isHidden) {
      popover.classList.remove('hidden')
      popover.querySelectorAll('.todo-sort-opt').forEach(opt => {
        opt.classList.toggle('font-semibold', opt.dataset.sort === currentSort)
        opt.classList.toggle('text-primary', opt.dataset.sort === currentSort)
      })
    }
  })

  document.querySelectorAll('.todo-sort-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      currentSort = opt.dataset.sort
      document.getElementById('todo-sort-popover').classList.add('hidden')
      document.getElementById('todo-sort-btn').classList.add('text-primary')
      sortTodos()
      renderList()
    })
  })

  document.addEventListener('click', (e) => {
    const popover = document.getElementById('todo-sort-popover')
    const btn = document.getElementById('todo-sort-btn')
    if (popover && btn && !popover.classList.contains('hidden') && !btn.contains(e.target) && !popover.contains(e.target)) {
      popover.classList.add('hidden')
    }
  })

  const fab = document.createElement('div')
  fab.id = 'app-fab'
  fab.className = 'fixed bottom-20 right-4 z-50'
  fab.innerHTML = `<button class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-vibgyor-violet text-white shadow-lg flex items-center justify-center text-2xl hover:scale-105 active:scale-95 transition-transform" id="todo-fab"><ion-icon name="add-outline"></ion-icon></button>`
  document.body.appendChild(fab)

  document.getElementById('todo-fab').addEventListener('click', async () => {
    await saveTodo({ note: 'New todo', targetDate: todayISO(), status: 'open', color: '' })
    todos = await getAllTodos()
    sortTodos()
    logAction('create', 'todo', '', 'Created todo: New todo')
    showToast('ToDo added — double-tap note to edit')
    renderList()
  })

  renderList()
}