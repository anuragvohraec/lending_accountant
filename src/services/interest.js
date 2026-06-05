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

  const dayBefore = new Date(start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  let outstanding = getOutstandingForParty(transactions, toLocalDateStr(dayBefore))

  // Group same-date transactions
  const groups = []
  for (const txn of sorted) {
    const txnDate = new Date(txn.date)
    if (txnDate >= end) break
    if (txnDate < start) continue
    const last = groups[groups.length - 1]
    if (last && last.date.getTime() === txnDate.getTime()) {
      last.txns.push(txn)
      if (txn.type === 'debit') last.debit += txn.amount
      else if (txn.type === 'credit') last.credit += txn.amount
    } else {
      groups.push({
        date: txnDate,
        txns: [txn],
        debit: txn.type === 'debit' ? txn.amount : 0,
        credit: txn.type === 'credit' ? txn.amount : 0,
      })
    }
  }

  // Handle initial gap (start to first group) where pre-existing outstanding accrues
  if (groups.length > 0 && groups[0].date > start) {
    const gapDays = Math.floor((groups[0].date - start) / 86400000)
    if (gapDays > 0 && outstanding > 0) {
      const interestAmount = Math.round(outstanding * rate * gapDays / 3000 * 100) / 100
      if (interestAmount > 0) {
        entries.push({
          amount: interestAmount,
          date: toLocalDateStr(start),
          fromDate: toLocalDateStr(start),
          toDate: toLocalDateStr(groups[0].date),
          days: gapDays,
          outstanding,
          debit: 0,
          credit: 0,
        })
      }
    }
  }

  // One entry per transaction group — each shows the group's date, combined debit/credit,
  // outstanding after applying it, and the interest it generates until the next event
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    outstanding += group.debit - group.credit

    const nextDate = i < groups.length - 1 ? groups[i + 1].date : end
    if (nextDate > group.date && outstanding > 0) {
      const rawDays = Math.floor((nextDate - group.date) / 86400000)
      const days = (nextDate >= end) ? rawDays + 1 : rawDays
      if (days > 0) {
        const interestAmount = Math.round(outstanding * rate * days / 3000 * 100) / 100
        if (interestAmount > 0) {
          entries.push({
            amount: interestAmount,
            date: toLocalDateStr(group.date),
            fromDate: toLocalDateStr(group.date),
            toDate: toLocalDateStr(nextDate >= end ? end : nextDate),
            days,
            outstanding,
            debit: group.debit,
            credit: group.credit,
          })
        }
      }
    }
  }

  // No groups but pre-existing outstanding — full-period entry
  if (groups.length === 0 && outstanding > 0) {
    const rawDays = Math.floor((end - start) / 86400000)
    const days = rawDays + 1
    if (days > 0) {
      const interestAmount = Math.round(outstanding * rate * days / 3000 * 100) / 100
      if (interestAmount > 0) {
        entries.push({
          amount: interestAmount,
          date: toLocalDateStr(end),
          fromDate: toLocalDateStr(start),
          toDate: toLocalDateStr(end),
          days,
          outstanding,
          debit: 0,
          credit: 0,
        })
      }
    }
  }

  return entries
}

export function getPendingInterestByParty(allTxns, parties) {
  const result = []
  for (const p of parties) {
    if (!p.interestRate) continue
    const txns = allTxns.filter(t => t.partyId === p._id && isInterest(t))
    const charges = txns.filter(t => t.type === 'charge').reduce((s, t) => s + t.amount, 0)
    const payments = txns.filter(t => t.type === 'payment').reduce((s, t) => s + t.amount, 0)
    const pending = Math.round((charges - payments) * 100) / 100
    if (pending > 0) {
      const chargeCount = txns.filter(t => t.type === 'charge').length
      result.push({ party: p, amount: pending, charges: chargeCount })
    }
  }
  return result.sort((a, b) => b.amount - a.amount)
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
