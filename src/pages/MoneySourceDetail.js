import { getMoneySource, saveMoneySource, getAllTransactions, getSourceTransactions, saveSourceTransaction, deleteSourceTransaction, getParties } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, formatDate, sourceTypeIcon } from '../utils/formatters.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'

export async function renderMoneySourceDetail(container, navigate, params) {
  const removeLoader = showSkeleton(container)
  const [source, allTxns, sourceTxns, allParties] = await Promise.all([
    getMoneySource(params.id),
    getAllTransactions(),
    getSourceTransactions(params.id),
    getParties(),
  ])
  removeLoader()

  if (!source) {
    container.innerHTML = '<div class="empty-state"><p>Source not found</p></div>'
    return
  }

  renderHeader(source.name, {
    onBack: () => navigate('money-sources'),
  })

  const principalTxns = allTxns.filter((t) => {
    if (!t.sourceAllocations || t.category === 'interest') return false
    return t.sourceAllocations.some((a) => a.sourceId === source._id)
  }).sort((a, b) => new Date(a.date) - new Date(b.date))

  const totalSourceCredits = sourceTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const totalSourceDebits = sourceTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
  const totalLoansGiven = principalTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === source._id)?.amount || 0), 0)
  const totalRepayments = principalTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + (t.sourceAllocations?.find((a) => a.sourceId === source._id)?.amount || 0), 0)
  const balance = (source.openingBalance || 0) + totalSourceCredits - totalSourceDebits - totalLoansGiven + totalRepayments
  const lentOut = totalLoansGiven
  const repaidToSource = totalRepayments

  container.innerHTML = `
    <div class="space-y-4 slide-up">
      <div class="card-flat">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-${source.type === 'cash' ? 'green' : source.type === 'bank' ? 'blue' : source.type === 'partner' ? 'purple' : 'gray'}-50 flex items-center justify-center text-${source.type === 'cash' ? 'green' : source.type === 'bank' ? 'blue' : source.type === 'partner' ? 'purple' : 'gray'}-600">
            <ion-icon name="${sourceTypeIcon(source.type)}" class="text-lg"></ion-icon>
          </div>
          <div>
            <div class="font-bold text-lg">${source.name}</div>
            <div class="text-xs text-gray-400 capitalize">${source.type}${source.owner ? ' · ' + source.owner : ''}</div>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <div class="stat-label">Balance</div>
            <div class="stat-value text-primary">${formatCurrency(balance)}</div>
          </div>
          <div>
            <div class="stat-label">Lent Out</div>
            <div class="stat-value text-amber-600">${formatCurrency(lentOut)}</div>
          </div>
          <div>
            <div class="stat-label">Repaid</div>
            <div class="stat-value text-green-600">${formatCurrency(repaidToSource)}</div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <h3 class="font-bold text-sm">Ledger</h3>
        <button class="btn-primary text-xs py-1.5 px-3" id="add-ledger-entry"><ion-icon name="add-outline" class="text-sm mr-1"></ion-icon>Add Entry</button>
      </div>

      <div id="source-ledger" class="space-y-1"></div>
    </div>
  `

  document.getElementById('add-ledger-entry').addEventListener('click', () => showSourceTxnForm(source._id, container, navigate))

  renderLedger(container, source, sourceTxns, principalTxns, allParties, navigate)
}

function renderLedger(container, source, sourceTxns, principalTxns, allParties, navigate) {
  const el = document.getElementById('source-ledger')

  const entries = [
    ...sourceTxns.map((t) => ({ ...t, entryType: 'source' })),
    ...principalTxns.map((t) => {
      const party = allParties.find((p) => p._id === t.partyId)
      return { ...t, entryType: 'principal', description: `${t.type === 'debit' ? 'Loan given' : 'Repayment'} — ${party?.name || t.partyId}` }
    }),
  ]
  entries.sort((a, b) => new Date(a.date) - new Date(b.date))

  const opening = source.openingBalance || 0
  let running = opening

  const openingRow = `
    <div class="flex items-start justify-between py-2.5 border-b border-gray-50 opacity-70">
      <div class="flex-1 min-w-0">
        <div class="text-xs text-gray-400">${formatDate(source.createdAt || source.updatedAt)}</div>
        <div class="text-sm font-semibold truncate">Opening Balance</div>
      </div>
      <div class="text-right ml-3">
        <div class="font-mono text-sm font-semibold">${formatCurrencyFull(opening)}</div>
        <div class="font-mono text-xs text-gray-400">${formatCurrencyFull(running)}</div>
      </div>
    </div>
  `

  if (entries.length === 0) {
    el.innerHTML = openingRow + '<p class="text-xs text-gray-400 text-center py-4">No ledger entries yet. Tap "Add Entry" to record a deposit or withdrawal.</p>'
    return
  }

  el.innerHTML = openingRow + entries.map((e) => {
    let displayAmount = e.amount
    let isDebit = e.type === 'debit'
    let isCredit = e.type === 'credit'

    if (e.entryType === 'principal') {
      displayAmount = e.sourceAllocations?.find((a) => a.sourceId === source._id)?.amount || 0
    }

    running += isCredit ? displayAmount : -displayAmount

    const isSourceEntry = e.entryType === 'source'

    return `
      <div class="flex items-start justify-between py-2.5 border-b border-gray-50 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="text-xs text-gray-400">${formatDate(e.date)}</div>
          <div class="text-sm truncate">${e.description}</div>
          ${isSourceEntry && e._id ? `
            <div class="flex gap-2 mt-1">
              <button class="text-xs text-red-400 delete-srctxn" data-id="${e._id}" data-source="${source._id}">Delete</button>
            </div>
          ` : ''}
        </div>
        <div class="text-right ml-3">
          ${isDebit ? `<div class="font-mono text-sm text-red-500">-${formatCurrencyFull(displayAmount)}</div>` :
            `<div class="font-mono text-sm text-green-600">+${formatCurrencyFull(displayAmount)}</div>`
          }
          <div class="font-mono text-xs text-gray-400">${formatCurrencyFull(running)}</div>
        </div>
      </div>
    `
  }).join('')

  el.querySelectorAll('.delete-srctxn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm({ title: 'Delete Entry?', message: 'This will permanently remove this ledger entry.', confirmText: 'Delete', danger: true })
      if (!confirmed) return
      await deleteSourceTransaction(btn.dataset.id)
      logAction('delete', 'source_transaction', btn.dataset.id, 'Deleted source ledger entry')
      showToast('Entry deleted')
      renderMoneySourceDetail(container, navigate, { id: btn.dataset.source })
    })
  })
}

async function showSourceTxnForm(sourceId, container, navigate) {
  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Type *</label>
        <select class="input" id="stxn-type">
          <option value="credit">Credit (Money In)</option>
          <option value="debit">Debit (Money Out)</option>
        </select>
      </div>
      <div>
        <label class="input-label">Amount *</label>
        <input class="input" id="stxn-amount" type="number" step="0.01" placeholder="0.00" />
      </div>
      <div>
        <label class="input-label">Date *</label>
        <input class="input" id="stxn-date" type="date" value="${new Date().toISOString().split('T')[0]}" />
      </div>
      <div>
        <label class="input-label">Description *</label>
        <input class="input" id="stxn-desc" placeholder="e.g. Bank interest charged, Cash deposited, Tax paid" />
      </div>
    </div>
  `

  const result = await showModal({
    title: 'Add Ledger Entry',
    content,
    confirmText: 'Add',
    onConfirm: () => {
      const amount = parseFloat(document.getElementById('stxn-amount')?.value)
      if (!amount || amount <= 0) { showToast('Valid amount is required', 'error'); return false }
      const desc = document.getElementById('stxn-desc')?.value.trim()
      if (!desc) { showToast('Description is required', 'error'); return false }
      return {
        sourceId,
        type: document.getElementById('stxn-type')?.value || 'credit',
        amount,
        date: document.getElementById('stxn-date')?.value || new Date().toISOString(),
        description: desc,
      }
    },
  })

  if (!result || result === true) return

  await saveSourceTransaction(result)
  logAction('create', 'source_transaction', result._id || '', `Added ${result.type} entry of ${result.amount} to source ledger`)
  showToast('Ledger entry added')

  const source = await getMoneySource(sourceId)
  const txnDelta = result.type === 'credit' ? result.amount : -result.amount
  const newBalance = (source.currentBalance ?? source.openingBalance ?? 0) + txnDelta
  await saveMoneySource({ _id: sourceId, currentBalance: newBalance, updatedAt: new Date().toISOString() })

  renderMoneySourceDetail(container, navigate, { id: sourceId })
}
