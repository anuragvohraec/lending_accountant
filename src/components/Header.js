export function renderHeader(title, options = {}) {
  const { onBack, rightAction } = options
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const header = document.getElementById('app-header')
  header.innerHTML = `
    <div class="flex items-center gap-2 w-full">
      <span class="text-[10px] font-medium text-gray-400 shrink-0 w-10 text-center leading-none">${today}</span>
      ${onBack ? `<button class="btn-icon btn-ghost -ml-1" id="header-back"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>` : ''}
      <h1 class="text-lg font-bold bg-gradient-to-r from-primary to-vibgyor-violet bg-clip-text text-transparent flex-1 truncate">${title}</h1>
      ${rightAction ? rightAction : ''}
    </div>
  `
  if (onBack) {
    document.getElementById('header-back').addEventListener('click', onBack)
  }
}
