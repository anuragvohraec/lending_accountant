export function calculateInterest({ principal, rate, fromDate, toDate }) {
  if (!principal || !rate || !fromDate) return { interest: 0, total: principal }
  const end = toDate ? new Date(toDate) : new Date()
  const start = new Date(fromDate)
  const days = Math.max(0, Math.floor((end - start) / 86400000))
  if (days === 0) return { interest: 0, total: principal, days: 0 }
  const interest = Math.round(principal * rate * days / 3000 * 100) / 100
  return {
    interest,
    total: Math.round((principal + interest) * 100) / 100,
    days,
    principal,
    rate,
  }
}

export function isPrincipal(t) {
  return !t.category || t.category === 'principal'
}

export function isInterest(t) {
  return t.category === 'interest'
}

export function getOutstandingForParty(transactions, asOfDate) {
  let totalDebit = 0
  let totalCredit = 0
  const cutoff = asOfDate ? new Date(asOfDate) : new Date()
  for (const t of transactions) {
    if (!isPrincipal(t)) continue
    if (new Date(t.date) > cutoff) continue
    if (t.type === 'debit') totalDebit += t.amount
    else if (t.type === 'credit') totalCredit += t.amount
  }
  return Math.round((totalDebit - totalCredit) * 100) / 100
}

export function getInterestPending(transactions, asOfDate) {
  let totalCharges = 0
  let totalPayments = 0
  const cutoff = asOfDate ? new Date(asOfDate) : new Date()
  for (const t of transactions) {
    if (!isInterest(t)) continue
    if (new Date(t.date) > cutoff) continue
    if (t.type === 'charge') totalCharges += t.amount
    else if (t.type === 'payment') totalPayments += t.amount
  }
  return Math.round((totalCharges - totalPayments) * 100) / 100
}

export function getLastInterestChargeDate(transactions) {
  const charges = transactions
    .filter((t) => isInterest(t) && t.type === 'charge')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
  return charges.length > 0 ? charges[0].date : null
}

export function getFirstPrincipalDate(transactions) {
  const principal = transactions
    .filter((t) => isPrincipal(t) && t.type === 'debit')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
  return principal.length > 0 ? principal[0].date : null
}

export function getOutstandingAtDate(transactions, date) {
  return getOutstandingForParty(transactions, date)
}

function toLocalDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function calculateMonthlyCharges({ transactions, rate, fromDate, toDate }) {
  const entries = []
  const start = new Date(fromDate)
  const end = new Date(toDate)
  if (start >= end) return entries

  const sorted = transactions
    .filter((t) => isPrincipal(t))
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  let current = new Date(start)
  let outstanding = getOutstandingForParty(transactions, toLocalDateStr(current))
  let prevTxn = null

  for (const txn of sorted) {
    const txnDate = new Date(txn.date)
    if (txnDate <= current) {
      if (txnDate.getTime() === current.getTime()) prevTxn = txn
      continue
    }
    if (txnDate >= end) break

    const days = Math.floor((txnDate - current) / 86400000)
    if (days > 0 && outstanding > 0) {
      const interestAmount = Math.round(outstanding * rate * days / 3000 * 100) / 100
      if (interestAmount > 0) {
        entries.push({
          amount: interestAmount,
          date: toLocalDateStr(txnDate),
          fromDate: toLocalDateStr(current),
          toDate: toLocalDateStr(txnDate),
          days,
          outstanding,
          debit: prevTxn?.type === 'debit' ? prevTxn.amount : 0,
          credit: prevTxn?.type === 'credit' ? prevTxn.amount : 0,
        })
      }
    }

    if (txn.type === 'debit') outstanding += txn.amount
    else if (txn.type === 'credit') outstanding -= txn.amount
    current = txnDate
    prevTxn = txn
  }

  if (current < end && outstanding > 0) {
    const rawDays = Math.floor((end - current) / 86400000)
    const days = rawDays + 1
    if (days > 0) {
      const interestAmount = Math.round(outstanding * rate * days / 3000 * 100) / 100
      if (interestAmount > 0) {
        entries.push({
          amount: interestAmount,
          date: toLocalDateStr(end),
          fromDate: toLocalDateStr(current),
          toDate: toLocalDateStr(end),
          days,
          outstanding,
          debit: prevTxn?.type === 'debit' ? prevTxn.amount : 0,
          credit: prevTxn?.type === 'credit' ? prevTxn.amount : 0,
        })
      }
    }
  }

  return entries
}

export function getPartnerWiseOutstanding(transactions, sources, asOfDate) {
  const ownerMap = {}
  const cutoff = asOfDate ? new Date(asOfDate) : new Date()
  for (const t of transactions) {
    if (!isPrincipal(t)) continue
    if (new Date(t.date) > cutoff) continue
    if (t.sourceAllocations) {
      for (const alloc of t.sourceAllocations) {
        const src = sources.find((s) => s._id === alloc.sourceId)
        const key = src?.owner || src?.name || alloc.sourceId
        if (!ownerMap[key]) ownerMap[key] = 0
        if (t.type === 'debit') ownerMap[key] += alloc.amount
        else ownerMap[key] -= alloc.amount
      }
    }
  }
  for (const key in ownerMap) {
    ownerMap[key] = Math.round(ownerMap[key] * 100) / 100
  }
  return ownerMap
}
