export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container')
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-blue-500' }
  const icons = { success: 'checkmark-circle-outline', error: 'alert-circle-outline', warning: 'warning-outline', info: 'information-circle-outline' }
  const toast = document.createElement('div')
  toast.className = `${colors[type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium slide-up`
  toast.innerHTML = `<ion-icon name="${icons[type]}" class="text-lg shrink-0"></ion-icon><span>${message}</span>`
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s'
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}
