import { formatCurrencyFull } from '../utils/formatters.js'

function isInterest(t) { return t.category === 'interest' }

export function generateInterestReport(allTxns, parties) {
  const reportData = []
  for (const p of parties) {
    if (!p.interestRate) continue
    const txns = allTxns.filter(t => t.partyId === p._id)
    const interestTxns = txns.filter(isInterest).sort((a, b) => new Date(b.date) - new Date(a.date))
    const charges = interestTxns.filter(t => t.type === 'charge')
    const payments = interestTxns.filter(t => t.type === 'payment')
    const lastCharge = charges[0]
    if (!lastCharge) continue
    const paymentsAfterCharge = lastCharge ? payments.filter(t => new Date(t.date) >= new Date(lastCharge.date)) : []
    const paymentsAfterSum = paymentsAfterCharge.reduce((s, t) => s + t.amount, 0)
    const totalCharged = charges.reduce((s, t) => s + t.amount, 0)
    const totalPaid = payments.reduce((s, t) => s + t.amount, 0)
    const netPending = Math.round((totalCharged - totalPaid) * 100) / 100
    reportData.push({
      party: p,
      lastCharge,
      paymentsAfter: paymentsAfterCharge,
      paymentsAfterSum,
      totalCharged,
      totalPaid,
      netPending,
    })
  }
  return reportData.sort((a, b) => b.netPending - a.netPending)
}

export function renderReportOverlay(reportData, onClose) {
  const overlay = document.createElement('div')
  overlay.id = 'report-overlay'
  overlay.className = 'fixed inset-0 z-[100] bg-white overflow-y-auto'
  overlay.innerHTML = `
    <div id="report-toolbar" class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
      <h2 class="text-sm font-semibold">Interest Collection Report</h2>
      <div class="flex items-center gap-2">
        <button class="btn-primary text-xs px-3 py-1.5" id="print-report"><ion-icon name="print-outline" class="mr-1"></ion-icon>Print</button>
        <button class="btn-ghost text-xs px-3 py-1.5" id="close-report"><ion-icon name="close-outline" class="text-lg"></ion-icon></button>
      </div>
    </div>
    <div id="report-body" class="px-4 py-4 max-w-4xl mx-auto">
      <div class="report-columns font-mono">
        ${reportData.map(r => renderPartyReport(r)).join('')}
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
      body * { visibility: hidden !important; }
      #report-overlay, #report-overlay * { visibility: visible !important; }
      #report-overlay { position: fixed !important; inset: 0 !important; z-index: 9999 !important; }
      #report-toolbar { display: none !important; }
      #report-body { max-width: none !important; padding: 10mm 8mm !important; }
      .report-columns { column-count: 2 !important; column-gap: 6mm !important; }
      .report-party { break-inside: avoid !important; page-break-inside: avoid !important; margin-bottom: 4mm !important; font-size: 7pt !important; }
      .report-party h3 { font-size: 8pt !important; margin-bottom: 1mm !important; }
      .report-party h4 { font-size: 7pt !important; margin-bottom: 0.5mm !important; }
      .report-party table { font-size: 6pt !important; }
      .report-party th, .report-party td { padding: 0.5mm 1mm !important; }
      @page { size: A4; margin: 10mm 8mm; }
    }
  `
  document.head.appendChild(style)
}

function renderPartyReport(r) {
  const lc = r.lastCharge
  const breakdown = lc?.breakdown || []
  const totalDays = breakdown.reduce((s, b) => s + b.days, 0)
  const hasPartialPayment = r.paymentsAfter.length > 0
  return `
    <div class="report-party">
      <h3 class="text-xs font-bold mb-0.5">${r.party.name}</h3>
      <p class="text-[10px] text-gray-500 mb-1">${r.party.interestRate}%/mo — Rate: ${r.party.interestRate}% per month</p>
      ${lc ? `
      <h4 class="text-[10px] font-semibold mb-0.5">Last Interest Charge: ${formatCurrencyFull(lc.amount)} on ${lc.date}</h4>
      <table class="w-full text-[10px] border-collapse mb-1">
        <thead>
          <tr class="border-b border-gray-300">
            <th class="text-left pr-1 font-medium">Debit</th>
            <th class="text-left pr-1 font-medium">Credit</th>
            <th class="text-right pr-1 font-medium">Outstanding</th>
            <th class="text-left px-1 font-medium">Date</th>
            <th class="text-right px-1 font-medium">Days</th>
            <th class="text-right pl-1 font-medium">Interest</th>
          </tr>
        </thead>
        <tbody>
          ${breakdown.map(b => `
            <tr class="border-b border-gray-100">
              <td class="text-left pr-1 py-0.5 ${b.debit > 0 ? 'text-red-600 font-medium' : 'text-gray-300'}">${b.debit > 0 ? formatCurrencyFull(b.debit) : '-'}</td>
              <td class="text-left pr-1 py-0.5 ${b.credit > 0 ? 'text-green-600 font-medium' : 'text-gray-300'}">${b.credit > 0 ? formatCurrencyFull(b.credit) : '-'}</td>
              <td class="text-right pr-1 py-0.5">${formatCurrencyFull(b.outstanding)}</td>
              <td class="text-left px-1 py-0.5">${b.date}</td>
              <td class="text-right px-1 py-0.5">${b.days}</td>
              <td class="text-right pl-1 py-0.5">${formatCurrencyFull(b.amount)}</td>
            </tr>
          `).join('')}
          <tr class="font-semibold border-t border-gray-400">
            <td colspan="4" class="text-right pr-1 py-0.5"></td>
            <td class="text-right px-1 py-0.5">${totalDays}</td>
            <td class="text-right pl-1 py-0.5">${formatCurrencyFull(lc.amount)}</td>
          </tr>
        </tbody>
      </table>
      ` : '<p class="text-[10px] text-gray-400">No interest charged yet</p>'}
      ${hasPartialPayment ? `
      <h4 class="text-[10px] font-semibold mb-0.5">Net Interest Pending</h4>
      <table class="w-full text-[10px] border-collapse mb-1">
        <tbody>
          <tr class="border-b border-gray-100">
            <td class="py-0.5">Total Charged</td>
            <td class="text-right py-0.5">${formatCurrencyFull(r.totalCharged)}</td>
          </tr>
          <tr class="border-b border-gray-100">
            <td class="py-0.5">Payments After Last Charge (${r.paymentsAfter.length})</td>
            <td class="text-right py-0.5 text-green-600">-${formatCurrencyFull(r.paymentsAfterSum)}</td>
          </tr>
          <tr class="font-semibold border-t border-gray-400">
            <td class="py-0.5">Net Pending</td>
            <td class="text-right py-0.5 text-amber-600">${formatCurrencyFull(r.netPending)}</td>
          </tr>
        </tbody>
      </table>
      ` : `<p class="text-[10px] text-amber-600 mb-1">Pending: ${formatCurrencyFull(r.netPending)}</p>`}
    </div>
  `
}
