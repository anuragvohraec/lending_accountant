const NAV_ITEMS = [
  { id: 'dashboard', label: 'Home', icon: 'home-outline' },
  { id: 'money-sources', label: 'Sources', icon: 'wallet-outline' },
  { id: 'parties', label: 'Parties', icon: 'people-outline' },
  { id: 'todos', label: 'ToDo', icon: 'checkbox-outline', badge: true },
  { id: 'search', label: 'Search', icon: 'search-outline' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline' },
]

export async function renderNav(activeId, onNavigate) {
  const nav = document.getElementById('app-nav')

  let badgeHtml = ''
  if (NAV_ITEMS.find(i => i.id === 'todos')?.badge) {
    try {
      const { getPendingTodoCount } = await import('../db/database.js')
      const count = await getPendingTodoCount()
      if (count > 0) badgeHtml = `<span class="absolute -top-1 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 leading-none">${count > 99 ? '99+' : count}</span>`
    } catch {}
  }

  nav.innerHTML = `
    <div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-vibgyor-violet via-vibgyor-blue to-vibgyor-green"></div>
    <div class="flex items-center justify-between px-1 py-1">
      ${NAV_ITEMS.map((item) => `
        <button class="nav-link ${item.id === activeId ? 'active' : ''}" data-route="${item.id}">
          <div class="relative inline-flex">
            <ion-icon name="${item.icon}"></ion-icon>
            ${item.badge ? badgeHtml : ''}
          </div>
          <span>${item.label}</span>
        </button>
      `).join('')}
    </div>
  `
  nav.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate(btn.dataset.route))
  })
}
