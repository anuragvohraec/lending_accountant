import { formatCurrencyFull, formatDate } from '../utils/formatters.js'

function getPartnerKey(src) {
  return src?.owner?.trim() || src?.name || 'Unknown'
}

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function generatePartnerTransferReport({ fromDate, toDate, allSourceTxns, allSources }) {
  const sourceMap = {}
  allSources.forEach(s => { sourceMap[s._id] = s })

  const from = new Date(fromDate)
  const end = new Date(toDate)

  const transfers = allSourceTxns.filter(t =>
    t.category === 'transfer' &&
    t.type === 'debit' &&
    new Date(t.date) >= from &&
    new Date(t.date) <= end
  )

  const partnerSet = new Set()
  const matrix = {}

  for (const t of transfers) {
    const fromSrc = sourceMap[t.sourceId]
    const toSrc = sourceMap[t.pairSourceId]
    if (!fromSrc || !toSrc) continue
    const fromPartner = getPartnerKey(fromSrc)
    const toPartner = getPartnerKey(toSrc)
    partnerSet.add(fromPartner)
    partnerSet.add(toPartner)
    const key = `${fromPartner}||${toPartner}`
    matrix[key] = (matrix[key] || 0) + t.amount
  }

  const partners = Array.from(partnerSet).sort()

  const partnerTotalsGiven = {}
  const partnerTotalsReceived = {}
  partners.forEach(p => { partnerTotalsGiven[p] = 0; partnerTotalsReceived[p] = 0 })

  const rows = []
  for (const fromP of partners) {
    const cells = {}
    let totalGiven = 0
    for (const toP of partners) {
      const val = matrix[`${fromP}||${toP}`] || 0
      cells[toP] = val
      totalGiven += val
      partnerTotalsReceived[toP] += val
    }
    partnerTotalsGiven[fromP] = totalGiven
    rows.push({ partner: fromP, cells, totalGiven })
  }

  return { rows, partners, partnerTotalsGiven, partnerTotalsReceived, fromDate, toDate }
}

export function renderPartnerTransferReportOverlay(reportData, onClose) {
  const { rows, partners, partnerTotalsGiven, partnerTotalsReceived, fromDate, toDate } = reportData

  const overlay = document.createElement('div')
  overlay.id = 'report-overlay'
  overlay.className = 'fixed inset-0 z-[100] bg-white overflow-y-auto'
  overlay.innerHTML = `
    <div id="report-toolbar" class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
      <h2 class="text-sm font-semibold">Partner Transfer Report</h2>
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-gray-400">${formatDate(fromDate)} - ${formatDate(toDate)}</span>
        <button class="btn-primary text-xs px-3 py-1.5" id="print-report"><ion-icon name="print-outline" class="mr-1"></ion-icon>Print</button>
        <button class="btn-ghost text-xs px-3 py-1.5" id="close-report"><ion-icon name="close-outline" class="text-lg"></ion-icon></button>
      </div>
    </div>
    <div id="report-body" class="px-3 py-4">
      <div class="max-w-full overflow-x-auto">
        <table class="w-full text-[8px] border-collapse font-mono">
          <thead>
            <tr>
              <th class="text-left px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-300">From \\ To</th>
              ${partners.map(p => `<th class="text-right px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-300">${escHtml(p)}</th>`).join('')}
              <th class="text-right px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-400">Total Given</th>
              <th class="text-right px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-400">Received</th>
              <th class="text-right px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-400">Net</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const cells = partners.map(p => {
                const val = r.cells[p] || 0
                return `<td class="text-right px-1.5 py-1 text-[8px] font-mono ${val > 0 ? 'text-red-600' : ''}">${val > 0 ? formatCurrencyFull(val) : '-'}</td>`
              }).join('')
              const received = partnerTotalsReceived[r.partner] || 0
              const net = r.totalGiven - received
              return `<tr class="border-b border-gray-200">
                <td class="text-left px-1.5 py-1 text-[8px] font-medium">${escHtml(r.partner)}</td>
                ${cells}
                <td class="text-right px-1.5 py-1 text-[8px] font-mono font-bold">${formatCurrencyFull(r.totalGiven)}</td>
                <td class="text-right px-1.5 py-1 text-[8px] font-mono">${formatCurrencyFull(received)}</td>
                <td class="text-right px-1.5 py-1 text-[8px] font-mono font-bold ${net > 0 ? 'text-red-600' : net < 0 ? 'text-green-600' : ''}">${formatCurrencyFull(net)}</td>
              </tr>`
            }).join('')}
            <tr class="font-bold border-t-2 border-gray-400">
              <td class="text-left px-1.5 py-1 text-[8px]">Total Received</td>
              ${partners.map(p => `<td class="text-right px-1.5 py-1 text-[8px] font-mono">${formatCurrencyFull(partnerTotalsReceived[p] || 0)}</td>`).join('')}
              <td class="text-right px-1.5 py-1 text-[8px] font-mono">${formatCurrencyFull(partners.reduce((s, p) => s + partnerTotalsGiven[p], 0))}</td>
              <td class="text-right px-1.5 py-1 text-[8px] font-mono">${formatCurrencyFull(partners.reduce((s, p) => s + partnerTotalsReceived[p], 0))}</td>
              <td class="text-right px-1.5 py-1 text-[8px] font-mono">${formatCurrencyFull(partners.reduce((s, p) => s + (partnerTotalsGiven[p] || 0) - (partnerTotalsReceived[p] || 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  overlay.querySelector('#print-report').addEventListener('click', () => window.print())
  overlay.querySelector('#close-report').addEventListener('click', () => { overlay.remove(); onClose?.() })
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); onClose?.() } })

  const style = document.createElement('style')
  style.textContent = `
    @media print {
      html, body { height: auto; overflow: visible; margin: 0; padding: 0; }
      body > *:not(#report-overlay) { display: none !important; }
      #report-overlay { position: static !important; height: auto !important; overflow: visible !important; }
      #report-toolbar { display: none !important; }
      #report-body { padding: 8mm 12mm !important; max-width: none !important; }
      table { font-size: 9pt !important; width: 100% !important; }
      th, td { padding: 1.2mm 2mm !important; }
      @page { size: A4 landscape; margin: 10mm 12mm; }
    }
  `
  document.head.appendChild(style)
}

function escHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}