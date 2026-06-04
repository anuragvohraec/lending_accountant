export function renderHeader(title, options = {}) {
  const { onBack, rightAction } = options
  const header = document.getElementById('app-header')
  header.innerHTML = `
    <div class="flex items-center gap-3 w-full">
      ${onBack ? `<button class="btn-icon btn-ghost -ml-1" id="header-back"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>` : ''}
      <h1 class="text-lg font-bold bg-gradient-to-r from-primary to-vibgyor-violet bg-clip-text text-transparent flex-1 truncate">${title}</h1>
      ${rightAction ? rightAction : ''}
    </div>
  `
  if (onBack) {
    document.getElementById('header-back').addEventListener('click', onBack)
  }
}
