export function showLoading(container) {
  const el = document.createElement('div')
  el.className = 'flex items-center justify-center py-12'
  el.innerHTML = '<div class="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>'
  container.appendChild(el)
  return () => el.remove()
}

export function showSkeleton(container, count = 3) {
  const el = document.createElement('div')
  el.className = 'space-y-3 p-4'
  el.innerHTML = Array(count).fill('<div class="h-12 bg-gray-100 rounded-xl animate-pulse"></div>').join('')
  container.appendChild(el)
  return () => el.remove()
}
