function toDDMMYY(d) {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

function parseDDMMYY(str) {
  if (!str) return null
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const yr = y.length === 2 ? 2000 + parseInt(y) : parseInt(y)
  const date = new Date(yr, parseInt(mo) - 1, parseInt(d))
  if (date.getDate() !== parseInt(d) || date.getMonth() !== parseInt(mo) - 1) return null
  return date
}

function toISOStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function dateInputHTML({ id, value, placeholder = 'dd/mm/yy', cls = '' }) {
  const d = value ? new Date(value) : new Date()
  const displayVal = value ? toDDMMYY(d) : ''
  const isoVal = value ? toISOStr(d) : ''
  return `
    <div class="date-input-wrap flex items-center gap-1 ${cls}">
      <input type="text" class="input flex-1 date-text" id="${id}" placeholder="${placeholder}" value="${displayVal}" autocomplete="off" />
      <input type="date" class="date-native" id="${id}-native" value="${isoVal}" style="display:none" />
      <button type="button" class="date-clear-btn text-gray-400 text-lg p-1 shrink-0 ${value ? '' : 'hidden'}" data-target="${id}" title="Clear">
        <ion-icon name="close-circle-outline"></ion-icon>
      </button>
      <button type="button" class="date-picker-btn text-gray-500 text-lg p-1 -ml-1 shrink-0" data-target="${id}">
        <ion-icon name="calendar-outline"></ion-icon>
      </button>
    </div>
  `
}

export function setupDateInput(id) {
  const textEl = document.getElementById(id)
  const nativeEl = document.getElementById(id + '-native')
  if (!textEl || !nativeEl) return

  textEl.addEventListener('input', () => {
    const val = textEl.value.trim()
    if (val.length === 8 || val.length === 10) {
      const parsed = parseDDMMYY(val)
      if (parsed) {
        nativeEl.value = toISOStr(parsed)
      }
    }
  })

  textEl.addEventListener('blur', () => {
    const val = textEl.value.trim()
    if (!val) { nativeEl.value = ''; return }
    const parsed = parseDDMMYY(val)
    if (parsed) {
      textEl.value = toDDMMYY(parsed)
      nativeEl.value = toISOStr(parsed)
    }
  })

  nativeEl.addEventListener('change', () => {
    if (nativeEl.value) {
      const d = new Date(nativeEl.value + 'T00:00:00')
      textEl.value = toDDMMYY(d)
    }
  })

  function updateClearBtn() {
    const clearBtn = document.querySelector(`.date-clear-btn[data-target="${id}"]`)
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', !nativeEl.value)
    }
  }

  const clearBtn = document.querySelector(`.date-clear-btn[data-target="${id}"]`)
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      nativeEl.value = ''
      textEl.value = ''
      textEl.focus()
      textEl.dispatchEvent(new Event('input', { bubbles: true }))
      textEl.dispatchEvent(new Event('change', { bubbles: true }))
      updateClearBtn()
    })
  }

  nativeEl.addEventListener('change', updateClearBtn)
  textEl.addEventListener('input', updateClearBtn)

  updateClearBtn()

  const btn = document.querySelector(`.date-picker-btn[data-target="${id}"]`)
  if (btn) {
    btn.addEventListener('click', () => {
      nativeEl.showPicker ? nativeEl.showPicker() : nativeEl.click()
    })
  }
}

export function getDateInputValue(id) {
  const nativeEl = document.getElementById(id + '-native')
  return nativeEl ? nativeEl.value : ''
}

export function setDateInputValue(id, isoDate) {
  const textEl = document.getElementById(id)
  const nativeEl = document.getElementById(id + '-native')
  if (!textEl || !nativeEl) return
  nativeEl.value = isoDate || ''
  textEl.value = isoDate ? toDDMMYY(new Date(isoDate + 'T00:00:00')) : ''
  const clearBtn = document.querySelector(`.date-clear-btn[data-target="${id}"]`)
  if (clearBtn) clearBtn.classList.toggle('hidden', !nativeEl.value)
}
