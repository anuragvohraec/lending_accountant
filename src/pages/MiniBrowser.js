import { showToast } from '../components/Toast.js'

const LS_KEY = 'mb_history'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]').slice(0, 20) } catch { return [] }
}

function saveHistoryEntry(url) {
  let h = loadHistory()
  h = h.filter(e => e.url !== url)
  h.unshift({ url, ts: Date.now() })
  if (h.length > 20) h.length = 20
  localStorage.setItem(LS_KEY, JSON.stringify(h))
  return h
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export function renderMiniBrowser(main) {
  main.innerHTML = `
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-100 shrink-0">
        <div class="flex-1 flex items-center gap-1 bg-gray-50 rounded-lg px-3 py-1.5 border border-gray-200 focus-within:border-primary transition-colors min-w-0 overflow-hidden">
          <ion-icon name="globe-outline" class="text-gray-400 text-sm shrink-0"></ion-icon>
          <input id="mb-url" type="text" class="flex-1 bg-transparent text-sm outline-none min-w-0" placeholder="https://example.com" autocomplete="off" autocapitalize="none" spellcheck="false">
          <button id="mb-clear" class="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0 hidden"><ion-icon name="close-circle-outline"></ion-icon></button>
        </div>
        <button id="mb-scan" class="btn-ghost btn-icon text-gray-500 shrink-0" title="Scan QR"><ion-icon name="qr-code-outline" class="text-lg"></ion-icon></button>
        <button id="mb-go" class="btn-primary text-xs px-3 py-1.5 shrink-0">Go</button>
      </div>
      <div id="mb-frame-wrap" class="flex-1 bg-white relative">
        <div id="mb-placeholder" class="absolute inset-0 flex flex-col text-gray-400">
          <div class="flex-1 flex flex-col items-center justify-center pb-0">
            <ion-icon name="browsers-outline" class="text-5xl mb-3"></ion-icon>
            <p class="text-sm">Enter a URL and tap Go</p>
          </div>
          <div id="mb-history-wrap" class="px-4 pb-4 max-h-[60%] overflow-y-auto"></div>
        </div>
        <div id="mb-blocked" class="absolute inset-0 flex-col items-center justify-center text-gray-400 hidden">
          <ion-icon name="shield-outline" class="text-5xl mb-3"></ion-icon>
          <p class="text-sm font-medium text-gray-500">Site blocked iframe embedding</p>
          <p class="text-xs mt-1">Most sites prevent being loaded in an iframe.<br>Works best with internal/local websites.</p>
        </div>
        <iframe id="mb-frame" class="w-full h-full border-0 hidden" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      </div>
    </div>
  `

  const urlInput = document.getElementById('mb-url')
  const clearBtn = document.getElementById('mb-clear')
  const goBtn = document.getElementById('mb-go')
  const scanBtn = document.getElementById('mb-scan')
  const frame = document.getElementById('mb-frame')
  const placeholder = document.getElementById('mb-placeholder')
  const blocked = document.getElementById('mb-blocked')
  const historyWrap = document.getElementById('mb-history-wrap')

  function normalizeUrl(url) {
    url = url.trim()
    if (!url) return ''
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    return url
  }

  function showWelcome() {
    frame.src = ''
    frame.classList.add('hidden')
    blocked.classList.add('hidden'); blocked.classList.remove('flex')
    placeholder.classList.remove('hidden')
    const h = loadHistory()
    if (h.length) {
      historyWrap.innerHTML = `
        <div class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent</div>
        <div class="space-y-0.5">
          ${h.map(e => `
            <button class="mb-hist-btn w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 active:bg-gray-100 text-sm transition-colors" data-url="${escHtml(e.url)}">
              <ion-icon name="globe-outline" class="text-gray-400 shrink-0 text-xs"></ion-icon>
              <span class="truncate text-gray-700">${escHtml(e.url)}</span>
            </button>
          `).join('')}
        </div>
      `
      historyWrap.querySelectorAll('.mb-hist-btn').forEach(btn => {
        btn.addEventListener('click', () => loadUrl(btn.dataset.url))
      })
    } else {
      historyWrap.innerHTML = ''
    }
  }

  function loadUrl(url) {
    const normalized = normalizeUrl(url)
    if (!normalized) { showToast('Enter a URL', 'error'); return }
    urlInput.value = normalized
    saveHistoryEntry(normalized)
    blocked.classList.add('hidden'); blocked.classList.remove('flex')
    frame.src = normalized
    frame.classList.remove('hidden')
    placeholder.classList.add('hidden')
    clearBtn.classList.remove('hidden')
  }

  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadUrl(urlInput.value) })
  goBtn.addEventListener('click', () => loadUrl(urlInput.value))

  clearBtn.addEventListener('click', () => {
    urlInput.value = ''
    clearBtn.classList.add('hidden')
    showWelcome()
    urlInput.focus()
  })

  urlInput.addEventListener('input', () => {
    clearBtn.classList.toggle('hidden', !urlInput.value)
  })

  frame.addEventListener('load', () => {
    blocked.classList.add('hidden'); blocked.classList.remove('flex')
  })

  showWelcome()

  // QR Scanner
  scanBtn.addEventListener('click', () => {
    let stream = null, animId = null
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4'
    overlay.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-sm overflow-hidden">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="text-sm font-semibold">Scan QR Code</h3>
          <button class="btn-ghost btn-icon text-gray-400" id="mb-qr-close"><ion-icon name="close-outline" class="text-xl"></ion-icon></button>
        </div>
        <div class="p-4">
          <video id="mb-qr-video" autoplay playsinline class="w-full aspect-square rounded-xl bg-black object-cover mb-3"></video>
          <canvas id="mb-qr-canvas" class="hidden"></canvas>
          <p id="mb-qr-status" class="text-xs text-gray-400 text-center">Point camera at a QR code</p>
          <div class="flex gap-2 mt-3">
            <button class="btn-outline btn-sm flex-1" id="mb-qr-upload"><ion-icon name="image-outline" class="text-sm mr-1"></ion-icon>Upload Image</button>
          </div>
          <input type="file" accept="image/*" id="mb-qr-file" class="hidden" />
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } } })
        const video = document.getElementById('mb-qr-video')
        video.srcObject = stream
        await video.play()
        scanFrame()
      } catch {
        document.getElementById('mb-qr-status').textContent = 'Camera unavailable. Upload a QR image instead.'
      }
    }

    function scanFrame() {
      const video = document.getElementById('mb-qr-video')
      const canvas = document.getElementById('mb-qr-canvas')
      if (!video || !canvas || video.readyState < 2) { animId = requestAnimationFrame(scanFrame); return }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          document.getElementById('mb-qr-status').textContent = 'QR detected!'
          urlInput.value = code.data
          clearBtn.classList.remove('hidden')
          setTimeout(() => { stopScanner(); overlay.remove() }, 300)
          return
        }
      }
      animId = requestAnimationFrame(scanFrame)
    }

    function stopScanner() {
      if (animId) { cancelAnimationFrame(animId); animId = null }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null }
    }

    overlay.querySelector('#mb-qr-close').addEventListener('click', () => { stopScanner(); overlay.remove() })
    overlay.querySelector('#mb-qr-upload').addEventListener('click', () => document.getElementById('mb-qr-file')?.click())
    overlay.querySelector('#mb-qr-file').addEventListener('change', (e) => {
      const file = e.target.files[0]
      if (!file) return
      stopScanner()
      const reader = new FileReader()
      reader.onload = (ev) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.getElementById('mb-qr-canvas')
          canvas.width = img.width; canvas.height = img.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          if (window.jsQR) {
            const code = window.jsQR(imageData.data, imageData.width, imageData.height)
            if (code) {
              urlInput.value = code.data
              clearBtn.classList.remove('hidden')
              setTimeout(() => overlay.remove(), 300)
            } else {
              document.getElementById('mb-qr-status').textContent = 'No QR code found in image'
            }
          }
        }
        img.src = ev.target.result
      }
      reader.readAsDataURL(file)
    })

    overlay.addEventListener('click', (e) => { if (e.target === overlay) { stopScanner(); overlay.remove() } })
    startCamera()
  })
}
