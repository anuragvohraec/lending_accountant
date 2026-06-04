export function showModal({ title, content, onConfirm, onMounted, confirmText = 'Save', cancelText = 'Cancel', showCancel = true, danger = false }) {
  const container = document.getElementById('modal-container')
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black/40" data-dismiss></div>
    <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto slide-up p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">${title}</h2>
        <button class="btn-icon btn-ghost" data-dismiss><ion-icon name="close-outline" class="text-xl"></ion-icon></button>
      </div>
      <div class="modal-body">${content}</div>
      <div class="flex gap-3 mt-6">
        ${showCancel ? `<button class="btn-outline flex-1" data-dismiss>${cancelText}</button>` : ''}
        <button class="${danger ? 'btn-danger' : 'btn-primary'} flex-1" id="modal-confirm">${confirmText}</button>
      </div>
    </div>
  `
  container.appendChild(modal)
  if (typeof onMounted === 'function') onMounted()

  const dismiss = () => { modal.remove() }
  modal.querySelectorAll('[data-dismiss]').forEach((el) => el.addEventListener('click', dismiss))

  return new Promise((resolve) => {
    document.getElementById('modal-confirm').addEventListener('click', (e) => {
      if (typeof onConfirm === 'function') {
        let result
        try { result = onConfirm() } catch (err) { alert('Error: ' + err.message); return }
        if (result === false) return
        dismiss()
        resolve(result !== undefined ? result : true)
      } else {
        dismiss()
        resolve(true)
      }
    })
    modal.querySelector('.modal-body')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const btn = document.getElementById('modal-confirm')
        if (btn) btn.click()
      }
    })
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { dismiss(); resolve(false) }
    })
  })
}

export function showPrompt({ title, message, inputType = 'text', placeholder = '', confirmText = 'OK' }) {
  const container = document.getElementById('modal-container')
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black/40" data-dismiss></div>
    <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto slide-up p-6">
      <h2 class="text-lg font-bold mb-2">${title}</h2>
      ${message ? `<p class="text-sm text-gray-500 mb-4">${message}</p>` : ''}
      <input type="${inputType}" class="input" id="prompt-input" placeholder="${placeholder}" autofocus />
      <div class="flex gap-3 mt-4">
        <button class="btn-outline flex-1" data-dismiss>Cancel</button>
        <button class="btn-primary flex-1" id="prompt-confirm">${confirmText}</button>
      </div>
    </div>
  `
  container.appendChild(modal)

  const dismiss = () => { modal.remove() }
  modal.querySelectorAll('[data-dismiss]').forEach((el) => el.addEventListener('click', dismiss))

  return new Promise((resolve) => {
    const input = document.getElementById('prompt-input')
    document.getElementById('prompt-confirm').addEventListener('click', () => {
      dismiss()
      resolve(input.value)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        dismiss()
        resolve(input.value)
      }
    })
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { dismiss(); resolve(null) }
    })
    setTimeout(() => input.focus(), 100)
  })
}

export function showConfirm({ title, message, confirmText = 'Confirm', danger = false }) {
  const container = document.getElementById('modal-container')
  const modal = document.createElement('div')
  modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center fade-in'
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black/40" data-dismiss></div>
    <div class="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm slide-up p-6">
      <h2 class="text-lg font-bold mb-2">${title}</h2>
      ${message ? `<p class="text-sm text-gray-500 mb-4">${message}</p>` : ''}
      <div class="flex gap-3 mt-4">
        <button class="btn-outline flex-1" data-dismiss>Cancel</button>
        <button class="${danger ? 'btn-danger' : 'btn-primary'} flex-1" id="confirm-yes">${confirmText}</button>
      </div>
    </div>
  `
  container.appendChild(modal)

  const dismiss = () => { modal.remove() }
  modal.querySelectorAll('[data-dismiss]').forEach((el) => el.addEventListener('click', dismiss))

  return new Promise((resolve) => {
    document.getElementById('confirm-yes').addEventListener('click', () => {
      dismiss()
      resolve(true)
    })
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { dismiss(); resolve(false) }
    })
  })
}
