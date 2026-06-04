export function calculateInterest({ principal, rate, fromDate, toDate, frequency = 'monthly' }) {
  if (!principal || !rate || !fromDate) return { interest: 0, total: principal }
  const end = toDate ? new Date(toDate) : new Date()
  const start = new Date(fromDate)
  const days = Math.max(0, Math.floor((end - start) / 86400000))
  if (days === 0) return { interest: 0, total: principal, days: 0 }
  let interest
  if (frequency === 'monthly') {
    const months = days / 30.4375
    interest = principal * (rate / 100) * months
  } else if (frequency === 'yearly') {
    interest = principal * (rate / 100) * (days / 365)
  } else {
    interest = principal * (rate / 100) * (days / 365)
  }
  return {
    interest: Math.round(interest * 100) / 100,
    total: Math.round((principal + interest) * 100) / 100,
    days,
    principal,
    rate,
  }
}

export function calculateRunningInterest(transactions, rate, asOfDate) {
  let balance = 0
  let totalInterest = 0
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date))
  for (let i = 0; i < sorted.length; i++) {
    const txn = sorted[i]
    const prevDate = i === 0 ? txn.date : sorted[i - 1].date
    const interestCalc = calculateInterest({
      principal: balance,
      rate,
      fromDate: prevDate,
      toDate: txn.date,
    })
    totalInterest += interestCalc.interest
    balance += interestCalc.interest
    balance += txn.type === 'debit' ? txn.amount : -txn.amount
  }
  if (asOfDate && sorted.length > 0) {
    const lastDate = sorted[sorted.length - 1].date
    const finalInterest = calculateInterest({
      principal: balance,
      rate,
      fromDate: lastDate,
      toDate: asOfDate,
    })
    totalInterest += finalInterest.interest
    balance += finalInterest.interest
  }
  return { balance: Math.round(balance * 100) / 100, totalInterest: Math.round(totalInterest * 100) / 100 }
}

export function getOutstandingForParty(transactions, asOfDate) {
  let totalDebit = 0
  let totalCredit = 0
  const cutoff = asOfDate ? new Date(asOfDate) : new Date()
  for (const t of transactions) {
    if (new Date(t.date) > cutoff) continue
    if (t.type === 'debit') totalDebit += t.amount
    else totalCredit += t.amount
  }
  return Math.round((totalDebit - totalCredit) * 100) / 100
}

export function getSourceWiseOutstanding(transactions, asOfDate) {
  const sourceMap = {}
  const cutoff = asOfDate ? new Date(asOfDate) : new Date()
  for (const t of transactions) {
    if (new Date(t.date) > cutoff) continue
    if (t.sourceAllocations) {
      for (const alloc of t.sourceAllocations) {
        if (!sourceMap[alloc.sourceId]) sourceMap[alloc.sourceId] = 0
        if (t.type === 'debit') sourceMap[alloc.sourceId] += alloc.amount
        else sourceMap[alloc.sourceId] -= alloc.amount
      }
    }
  }
  for (const key in sourceMap) {
    sourceMap[key] = Math.round(sourceMap[key] * 100) / 100
  }
  return sourceMap
}
