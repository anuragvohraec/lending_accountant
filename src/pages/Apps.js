import { renderHeader } from '../components/Header.js'
import { getPendingTodoCount } from '../db/database.js'

const APPS = [
  { id: 'todos', label: 'ToDo', icon: 'checkbox-outline', color: '#F59E0B', route: 'todos', badge: true },
]

export async function renderApps(main, navigate) {
  renderHeader('Apps')

  const openTodos = APPS.find(a => a.id === 'todos')?.badge ? (await getPendingTodoCount()) : 0

  main.innerHTML = `
    <div class="max-w-lg mx-auto">
      <div class="grid grid-cols-3 gap-4 mt-6">
        ${APPS.map(app => {
          const badge = app.badge && openTodos > 0
          return `
            <button class="app-icon flex flex-col items-center gap-2 p-4 rounded-2xl hover:bg-gray-50 active:bg-gray-100 transition-colors" data-route="${app.route}">
              <div class="relative w-16 h-16 rounded-2xl flex items-center justify-center text-white text-3xl" style="background:${app.color}">
                <ion-icon name="${app.icon}"></ion-icon>
                ${badge ? `<span class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none border-2 border-white">${openTodos > 99 ? '99+' : openTodos}</span>` : ''}
              </div>
              <span class="text-xs font-medium text-gray-700">${app.label}</span>
            </button>
          `
        }).join('')}
      </div>
    </div>
  `

  main.querySelectorAll('[data-route]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.route))
  })
}
