import { formatCurrencyFull, formatDate } from '../utils/formatters.js'

function isPrincipal(t) { return !t.category || t.category === 'principal' }

function getPartnerKey(src) {
  return src?.owner?.trim() || src?.name || 'Unknown'
}

function getFinancialYearRange() {
  const now = new Date()
  const y = now.getFullYear()
  const aprStart = new Date(y, 3, 1)
  const start = now < aprStart ? new Date(y - 1, 3, 1) : aprStart
  const end = now < aprStart ? new Date(y, 2, 31) : new Date(y + 1, 2, 31)
  return {
    from: start.toISOString().split('T')[0],
    to: end.toISOString().split('T')[0],
    label: `${start.getFullYear()}-${end.getFullYear()}`
  }
}

function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().split('T')[0]
}

export function generateTaxReport({ partyIds, fromDate, toDate, allTxns, allSources, allParties }) {
  const from = new Date(fromDate)
  const end = new Date(toDate)
  const dayBefore = new Date(from)
  dayBefore.setDate(dayBefore.getDate() - 1)

  const sourceMap = {}
  allSources.forEach(s => { sourceMap[s._id] = s })

  // collect all partners used by selected parties' transactions
  const partnerSet = new Set()
  for (const pid of partyIds) {
    const txns = allTxns.filter(t => t.partyId === pid && isPrincipal(t) && new Date(t.date) >= from && new Date(t.date) <= end)
    for (const t of txns) {
      if (t.sourceAllocations && t.sourceAllocations.length > 0) {
        for (const alloc of t.sourceAllocations) {
          const src = sourceMap[alloc.sourceId]
          partnerSet.add(getPartnerKey(src))
        }
      } else {
        partnerSet.add('Unknown')
      }
    }
  }
  const partners = ['Unknown', ...Array.from(partnerSet).filter(p => p !== 'Unknown')].sort()

  // per-party report data
  const rows = []
  const totals = {}
  partners.forEach(p => { totals[p] = 0 })

  for (const pid of partyIds) {
    const party = allParties.find(p => p._id === pid)
    if (!party || !party.interestRate) continue
    const rate = party.interestRate

    // get transactions within range, sorted by date
    const txns = allTxns
      .filter(t => t.partyId === pid && isPrincipal(t))
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    // compute outstanding per partner at dayBefore
    const outstanding = {}
    partners.forEach(p => { outstanding[p] = 0 })
    for (const t of txns) {
      const tDate = new Date(t.date)
      if (tDate > dayBefore) break
      const allocs = t.sourceAllocations && t.sourceAllocations.length > 0 ? t.sourceAllocations : [{ sourceId: null, amount: t.amount }]
      for (const alloc of allocs) {
        const src = alloc.sourceId ? sourceMap[alloc.sourceId] : null
        const key = getPartnerKey(src)
        if (!outstanding.hasOwnProperty(key)) outstanding[key] = 0
        if (t.type === 'debit') outstanding[key] += alloc.amount
        else if (t.type === 'credit') outstanding[key] -= alloc.amount
      }
    }

    // now process transactions within the report range
    const rangeTxns = txns.filter(t => {
      const d = new Date(t.date)
      return d >= from && d <= end
    })

    const interest = {}
    partners.forEach(p => { interest[p] = 0 })

    let prevDate = from

    for (const t of rangeTxns) {
      const tDate = new Date(t.date)
      const days = Math.floor((tDate - prevDate) / 86400000)
      if (days > 0) {
        for (const p of partners) {
          if (outstanding[p] > 0) {
            interest[p] += Math.round(outstanding[p] * rate * days / 3000 * 100) / 100
          }
        }
      }

      // apply transaction amounts
      const allocs = t.sourceAllocations && t.sourceAllocations.length > 0 ? t.sourceAllocations : [{ sourceId: null, amount: t.amount }]
      for (const alloc of allocs) {
        const src = alloc.sourceId ? sourceMap[alloc.sourceId] : null
        const key = getPartnerKey(src)
        if (!outstanding.hasOwnProperty(key)) outstanding[key] = 0
        if (t.type === 'debit') outstanding[key] += alloc.amount
        else if (t.type === 'credit') outstanding[key] -= alloc.amount
      }

      prevDate = tDate
    }

    // remaining days to end date
    const remDays = Math.floor((end - prevDate) / 86400000) + 1
    if (remDays > 0) {
      for (const p of partners) {
        if (outstanding[p] > 0) {
          interest[p] += Math.round(outstanding[p] * rate * remDays / 3000 * 100) / 100
        }
      }
    }

    // round all
    for (const p of partners) {
      interest[p] = Math.round(interest[p] * 100) / 100
      totals[p] = Math.round((totals[p] + interest[p]) * 100) / 100
    }

    rows.push({ party, interest })
  }

  return { rows, partners, totals, fromDate, toDate }
}

export function renderTaxReportOverlay(reportData, onClose) {
  const { rows, partners, totals, fromDate, toDate } = reportData

  const headerCells = partners.map(p => `<th class="text-right px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-300">${escHtml(p)}</th>`).join('')

  const bodyRows = rows.map(r => {
    const cells = partners.map(p => {
      const val = r.interest[p] || 0
      return `<td class="text-right px-1.5 py-1 text-[8px] font-mono ${val > 0 ? 'text-red-600 font-medium' : ''}">${formatCurrencyFull(val)}</td>`
    }).join('')
    return `<tr class="border-b border-gray-200"><td class="text-left px-1.5 py-1 text-[8px] font-medium">${escHtml(r.party.name)}</td>${cells}</tr>`
  }).join('')

  const totalCells = partners.map(p => {
    const val = totals[p] || 0
    return `<td class="text-right px-1.5 py-1 text-[8px] font-mono font-bold border-t-2 border-gray-400 ${val > 0 ? 'text-red-600' : ''}">${formatCurrencyFull(val)}</td>`
  }).join('')

  const overlay = document.createElement('div')
  overlay.id = 'report-overlay'
  overlay.className = 'fixed inset-0 z-[100] bg-white overflow-y-auto'
  overlay.innerHTML = `
    <div id="report-toolbar" class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
      <h2 class="text-sm font-semibold">Tax Calculation Report</h2>
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
              <th class="text-left px-1.5 py-1 font-medium text-[8px] uppercase tracking-wider border-b-2 border-gray-300">Party</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
            <tr>
              <td class="text-left px-1.5 py-1 text-[8px] font-bold border-t-2 border-gray-400">Total</td>
              ${totalCells}
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
      @page { size: A4 portrait; margin: 12mm 15mm; }
    }
  `
  document.head.appendChild(style)
}

function escHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
