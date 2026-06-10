import { renderHeader } from '../components/Header.js'
import { getAllTodos, saveTodo, deleteTodo } from '../db/database.js'
import { formatDate } from '../utils/formatters.js'
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

export async function renderTodos(container, navigate) {
  renderHeader('ToDo')

  container.innerHTML = `
    <div class="px-4 pb-24">
      <div class="mb-3">
        <input class="input text-sm" id="todo-search" placeholder="Search notes (regex)...">
      </div>
      <div class="flex items-center gap-2 mb-3">
        <label class="flex items-center gap-1.5 text-xs text-gray-500">
          <input type="checkbox" id="todo-show-closed" />
          Show closed
        </label>
      </div>
      <div id="todo-list" class="space-y-2"></div>
    </div>
  `

  let todos = await getAllTodos()
  todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  function renderList() {
    const searchVal = document.getElementById('todo-search').value
    const showClosed = document.getElementById('todo-show-closed').checked
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
      return `
        <div class="card !p-0 todo-item ${t.status === 'closed' ? 'opacity-50' : ''}" data-id="${t._id}">
          <div class="flex items-center justify-between gap-2 px-2.5 py-1 bg-gray-50/80 rounded-t-xl">
            <button class="todo-toggle p-1 rounded-lg ${t.status === 'closed' ? 'text-green-500' : 'text-gray-300 hover:text-green-500'}" title="Toggle status">
              <ion-icon name="${t.status === 'closed' ? 'checkmark-circle' : 'checkmark-circle-outline'}" class="text-lg"></ion-icon>
            </button>
            <div class="todo-target-date text-[11px] font-medium text-center cursor-pointer leading-tight ${t.targetDate ? 'text-primary' : 'text-gray-400'}" data-id="${t._id}">
              ${t.targetDate ? fmtDate(t.targetDate) : '+ Add date'}
            </div>
            <button class="todo-delete p-1 rounded-lg text-gray-300 hover:text-red-400" title="Delete">
              <ion-icon name="trash-outline" class="text-base"></ion-icon>
            </button>
          </div>
          <div class="px-2.5 py-2">
            <div class="todo-note text-sm whitespace-pre-wrap break-words text-gray-700 mb-1.5 cursor-pointer select-none">${escHtml(t.note || '')}</div>
            <div class="text-[10px] text-gray-400">${cd}</div>
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
        const current = item.targetDate ? item.targetDate.slice(0, 10) : ''
        const input = document.createElement('input')
        input.type = 'date'
        input.className = 'input text-xs py-0.5 px-1 w-32 text-center'
        input.value = current
        el.innerHTML = ''
        el.appendChild(input)
        input.focus()
        input.addEventListener('blur', async () => {
          item.targetDate = input.value || ''
          item.updatedAt = new Date().toISOString()
          await saveTodo(item)
          renderList()
        })
        input.addEventListener('change', () => input.blur())
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
  document.getElementById('todo-show-closed').addEventListener('change', renderList)

  const fab = document.createElement('div')
  fab.id = 'app-fab'
  fab.className = 'fixed bottom-20 right-4 z-50'
  fab.innerHTML = `<button class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-vibgyor-violet text-white shadow-lg flex items-center justify-center text-2xl hover:scale-105 active:scale-95 transition-transform" id="todo-fab"><ion-icon name="add-outline"></ion-icon></button>`
  document.body.appendChild(fab)

  document.getElementById('todo-fab').addEventListener('click', async () => {
    await saveTodo({ note: 'New todo', targetDate: todayISO(), status: 'open' })
    todos = await getAllTodos()
    todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    logAction('create', 'todo', '', 'Created todo: New todo')
    showToast('ToDo added — double-tap note to edit')
    renderList()
  })

  renderList()
}
