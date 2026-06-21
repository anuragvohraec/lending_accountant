import { renderCalculator } from '../pages/Calculator.js'
import { renderTodos } from '../pages/Todos.js'
import { renderNotebook } from '../pages/Notebook.js'
import { renderCalendar } from '../pages/Calendar.js'
import { renderWarehouse } from '../pages/Warehouse.js'
import { renderMiniBrowser } from '../pages/MiniBrowser.js'
import { getPendingTodoCount } from '../db/database.js'

const APPS = [
  { id: 'calculator', label: 'Calculator', icon: 'calculator-outline', color: '#8B5CF6', render: renderCalculator },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-outline', color: '#EF4444', render: renderCalendar },
  { id: 'notebook', label: 'Notebook', icon: 'book-outline', color: '#10B981', render: renderNotebook },
  { id: 'todos', label: 'ToDo', icon: 'checkbox-outline', color: '#F59E0B', render: renderTodos },
  { id: 'warehouse', label: 'Warehouse', icon: 'business-outline', color: '#6366F1', render: renderWarehouse },
  { id: 'browser', label: 'Browser', icon: 'browsers-outline', color: '#3B82F6', render: renderMiniBrowser },
].sort((a, b) => a.label.localeCompare(b.label))

export async function showAppsModal() {
  const header = document.getElementById('app-header')
  const savedHeaderHTML = header.innerHTML

  const container = document.getElementById('modal-container')
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black/40" data-dismiss></div>
    <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl h-[90vh] flex flex-col slide-up" id="apps-modal-panel">
      <div class="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-2 border-b border-gray-100 shrink-0" id="apps-modal-header">
        <div class="flex items-center gap-2">
          <button class="btn-icon btn-ghost -ml-1 hidden" id="apps-modal-back"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
          <h2 class="text-lg font-bold" id="apps-modal-title">Apps</h2>
        </div>
        <button class="btn-icon btn-ghost" data-dismiss><ion-icon name="close-outline" class="text-xl"></ion-icon></button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6" id="apps-modal-body"></div>
    </div>
  `
  container.appendChild(modal)

  const title = document.getElementById('apps-modal-title')
  const body = document.getElementById('apps-modal-body')
  const backBtn = document.getElementById('apps-modal-back')

  function renderGrid() {
    const todoCount = APPS.some(a => a.id === 'todos') ? getPendingTodoCount() : Promise.resolve(0)
    todoCount.then(count => {
      body.innerHTML = `
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-4 mt-2">
          ${APPS.map(app => {
            const badge = app.id === 'todos' && count > 0
            return `
              <button class="app-icon flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors" data-app="${app.id}">
                <div class="relative w-14 h-14 rounded-2xl flex items-center justify-center text-white text-2xl" style="background:${app.color}">
                  <ion-icon name="${app.icon}"></ion-icon>
                  ${badge ? `<span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none border-2 border-white">${count > 99 ? '99+' : count}</span>` : ''}
                </div>
                <span class="text-xs font-medium text-gray-700">${app.label}</span>
              </button>
            `
          }).join('')}
        </div>
      `
    })
  }

  function showApp(appId) {
    const app = APPS.find(a => a.id === appId)
    if (!app) return
    const fab = document.getElementById('app-fab')
    if (fab) fab.remove()
    title.textContent = app.label
    backBtn.classList.remove('hidden')
    body.innerHTML = ''
    app.render(body, () => {})
  }

  function showGrid() {
    const fab = document.getElementById('app-fab')
    if (fab) fab.remove()
    title.textContent = 'Apps'
    backBtn.classList.add('hidden')
    renderGrid()
  }

  backBtn.addEventListener('click', showGrid)

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-app]')
    if (btn) showApp(btn.dataset.app)
  })

  const dismiss = () => {
    const fab = document.getElementById('app-fab')
    if (fab) fab.remove()
    modal.remove()
    header.innerHTML = savedHeaderHTML
  }
  modal.querySelectorAll('[data-dismiss]').forEach(el => el.addEventListener('click', dismiss))
  modal.addEventListener('click', (e) => { if (e.target === modal) dismiss() })

  renderGrid()
}
