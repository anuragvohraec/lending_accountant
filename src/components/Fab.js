export function renderFab(onClick) {
  const existing = document.getElementById('app-fab')
  if (existing) existing.remove()
  const fab = document.createElement('button')
  fab.id = 'app-fab'
  fab.className = 'fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-primary to-vibgyor-violet text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform'
  fab.innerHTML = '<ion-icon name="add-outline" class="text-2xl"></ion-icon>'
  fab.addEventListener('click', onClick)
  document.body.appendChild(fab)
}
