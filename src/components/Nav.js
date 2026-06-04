const NAV_ITEMS = [
  { id: 'dashboard', label: 'Home', icon: 'home-outline' },
  { id: 'money-sources', label: 'Sources', icon: 'wallet-outline' },
  { id: 'parties', label: 'Parties', icon: 'people-outline' },
  { id: 'search', label: 'Search', icon: 'search-outline' },
  { id: 'settings', label: 'Settings', icon: 'settings-outline' },
]

export function renderNav(activeId, onNavigate) {
  const nav = document.getElementById('app-nav')
  nav.innerHTML = `
    <div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-vibgyor-violet via-vibgyor-blue to-vibgyor-green"></div>
    <div class="flex items-center justify-around py-1">
      ${NAV_ITEMS.map((item) => `
        <button class="nav-link ${item.id === activeId ? 'active' : ''}" data-route="${item.id}">
          <ion-icon name="${item.icon}"></ion-icon>
          <span>${item.label}</span>
        </button>
      `).join('')}
    </div>
  `
  nav.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => onNavigate(btn.dataset.route))
  })
}
