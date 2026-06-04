import { renderNav } from './components/Nav.js'

const routes = {}

export function registerRoute(name, renderFn) {
  routes[name] = renderFn
}

export function navigate(name, params = {}) {
  const main = document.getElementById('app-main')
  main.innerHTML = ''
  window.scrollTo(0, 0)

  const fab = document.getElementById('app-fab')
  if (fab) fab.remove()

  const renderFn = routes[name]
  if (!renderFn) {
    main.innerHTML = '<div class="empty-state"><p>Page not found</p></div>'
    return
  }

  renderNav(name, (route) => navigate(route))
  renderFn(main, navigate, params)
}

export function initRouter() {
  navigate('dashboard')
}
