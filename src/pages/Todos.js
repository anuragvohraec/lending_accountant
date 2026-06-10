import { renderHeader } from '../components/Header.js'
import { getAllTodos, saveTodo, deleteTodo } from '../db/database.js'
import { formatDate } from '../utils/formatters.js'
import { dateInputHTML, setupDateInput, getDateInputValue, setDateInputValue } from '../utils/dateInput.js'
import { showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { logAction } from '../services/audit.js'

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
        <div class="card p-3 todo-item ${t.status === 'closed' ? 'opacity-50' : ''}" data-id="${t._id}">
          <div class="flex items-start gap-2">
            <div class="flex flex-col items-center gap-1 pt-0.5">
              <button class="btn-icon todo-toggle ${t.status === 'closed' ? 'text-green-500' : 'text-gray-300 hover:text-green-500'}" title="Toggle status">
                <ion-icon name="${t.status === 'closed' ? 'checkmark-circle' : 'checkmark-circle-outline'}" class="text-xl"></ion-icon>
              </button>
              <button class="btn-icon text-gray-300 hover:text-red-400 todo-delete" title="Delete">
                <ion-icon name="trash-outline" class="text-base"></ion-icon>
              </button>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2 mb-1">
                <div class="todo-target-date text-xs font-medium ${t.targetDate ? 'text-primary' : 'text-gray-400'}" data-id="${t._id}" contenteditable="false">
                  ${t.targetDate ? formatDate(t.targetDate) : 'Set target date'}
                </div>
                <span class="text-[10px] text-gray-400">${cd}</span>
              </div>
              <div class="todo-note text-sm whitespace-pre-wrap break-words text-gray-700" contenteditable="false">${escHtml(t.note || '')}</div>
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
      el.addEventListener('dblclick', () => {
        if (el.contentEditable === 'true') return
        const item = todos.find(t => t._id === el.dataset.id)
        if (!item) return
        const current = item.targetDate ? item.targetDate.slice(0, 10) : ''
        const input = document.createElement('input')
        input.type = 'date'
        input.className = 'input text-xs py-0.5 px-1 w-auto'
        input.value = current
        input.min = new Date().toISOString().split('T')[0]
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
      noteEl.addEventListener('dblclick', () => {
        if (noteEl.contentEditable === 'true') return
        noteEl.contentEditable = 'true'
        noteEl.focus()
        const item = todos.find(t => t._id === noteEl.closest('.todo-item').dataset.id)
        if (!item) return
        const save = async () => {
          noteEl.contentEditable = 'false'
          const val = noteEl.textContent.trim()
          if (val && val !== (item.note || '')) {
            item.note = val
            item.updatedAt = new Date().toISOString()
            await saveTodo(item)
            logAction('update', 'todo', item._id, `Edited todo: ${val.slice(0, 50)}`)
            showToast('ToDo updated')
          }
          renderList()
        }
        noteEl.addEventListener('blur', save, { once: true })
        noteEl.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { noteEl.textContent = item.note || ''; noteEl.blur() }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); noteEl.blur() }
        })
      })
    })
  }

  document.getElementById('todo-search').addEventListener('input', renderList)
  document.getElementById('todo-show-closed').addEventListener('change', renderList)

  // FAB
  const fab = document.createElement('div')
  fab.id = 'app-fab'
  fab.className = 'fixed bottom-20 right-4 z-50'
  fab.innerHTML = `<button class="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-vibgyor-violet text-white shadow-lg flex items-center justify-center text-2xl hover:scale-105 active:scale-95 transition-transform" id="todo-fab"><ion-icon name="add-outline"></ion-icon></button>`
  document.body.appendChild(fab)

  document.getElementById('todo-fab').addEventListener('click', async () => {
    const now = new Date()
    const note = 'New todo'
    await saveTodo({ note, targetDate: '', status: 'open' })
    todos = await getAllTodos()
    todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    logAction('create', 'todo', '', `Created todo: ${note}`)
    showToast('ToDo added — double-click note to edit')
    renderList()
  })

  renderList()
}

function escHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
