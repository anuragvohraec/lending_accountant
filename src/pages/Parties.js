import { getParties, saveParty, deleteParty, getAllTransactions } from '../db/database.js'
import { formatCurrency, formatCurrencyFull, accountStatusColor, formatDate } from '../utils/formatters.js'
import { getOutstandingForParty, getInterestPending } from '../services/interest.js'
import { renderHeader } from '../components/Header.js'
import { showModal, showConfirm } from '../components/Modal.js'
import { showToast } from '../components/Toast.js'
import { showSkeleton } from '../components/Loading.js'
import { logAction } from '../services/audit.js'
import { peopleIllustration } from '../assets/vectors.js'

export async function renderParties(container, navigate) {
  renderHeader('Lending Parties')

  window.__partyForm = () => showPartyForm(null, [], [], container, navigate)

  container.innerHTML = `
    <div class="slide-up">
      <div class="relative mb-4">
        <ion-icon name="search-outline" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></ion-icon>
        <input class="input pl-10" id="party-search" placeholder="Search by name or phone..." />
      </div>
      <div id="parties-list" class="space-y-2"></div>
    </div>
    <button class="fab-btn fixed bottom-24 right-4 z-50 w-14 h-14 bg-gradient-to-br from-primary to-vibgyor-violet text-white rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform" onclick="window.__partyForm()">
      <span class="text-2xl font-bold leading-none">+</span>
    </button>
  `

  const removeLoader = showSkeleton(container.querySelector('#parties-list'))
  let [parties, allTxns] = await Promise.all([getParties(), getAllTransactions()])
  removeLoader()

  window.__partyForm = () => showPartyForm(null, parties, allTxns, container, navigate)

  function renderPartyList(filter = '') {
    const el = document.getElementById('parties-list')
    const filtered = parties.filter((p) => {
      if (!filter) return true
      const q = filter.toLowerCase()
      return p.name?.toLowerCase().includes(q) || p.phone?.includes(q)
    })

    if (filtered.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          ${peopleIllustration()}
          <p class="font-medium text-gray-500 mb-1">${parties.length === 0 ? 'No parties yet' : 'No matches found'}</p>
          <p class="text-xs text-gray-400">${parties.length === 0 ? 'Add your first lending party' : 'Try a different search'}</p>
        </div>
      `
      return
    }

    el.innerHTML = filtered.map((p) => {
      const txns = allTxns.filter((t) => t.partyId === p._id)
      const outstanding = getOutstandingForParty(txns)
      const pendingInterest = p.interestRate ? getInterestPending(txns) : 0
      const statusClass = accountStatusColor(p.status)
      return `
        <div class="card-flat party-card cursor-pointer active:scale-[0.98] transition-transform" data-id="${p._id}">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary/10 to-vibgyor-violet/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              ${(p.name || '?').charAt(0).toUpperCase()}
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-sm">${p.name}</div>
              <div class="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                <span class="${statusClass}">${p.status}</span>
                ${p.phone ? `<span>${p.phone}</span>` : ''}
              </div>
              ${p.riskCategory ? `<div class="text-xs text-gray-400 mt-0.5 capitalize">${p.riskCategory} risk</div>` : ''}
            </div>
            <div class="text-right">
              <div class="text-xs text-gray-400">${outstanding > 0 ? 'Due' : 'Cleared'}</div>
              <div class="${outstanding > 0 ? 'amount-negative' : 'amount-neutral'}">${formatCurrencyFull(Math.abs(outstanding))}</div>
              ${pendingInterest > 0 ? `<div class="text-xs text-gray-400 mt-1">Int</div><div class="text-xs text-amber-600">${formatCurrencyFull(pendingInterest)}</div>` : ''}
            </div>
          </div>
        </div>
      `
    }).join('')

    el.querySelectorAll('.party-card').forEach((card) => {
      card.addEventListener('click', () => navigate('party-detail', { id: card.dataset.id }))
    })
  }

  renderPartyList()

  document.getElementById('party-search').addEventListener('input', (e) => {
    renderPartyList(e.target.value)
  })
}

async function showPartyForm(editParty, parties, allTxns, container, navigate) {
  const isEdit = !!editParty
  const content = `
    <div class="space-y-3">
      <div>
        <label class="input-label">Full Name *</label>
        <input class="input" id="pf-name" value="${editParty?.name || ''}" placeholder="Party full name" />
      </div>
      <div>
        <label class="input-label">Phone Number</label>
        <input class="input" id="pf-phone" type="tel" value="${editParty?.phone || ''}" placeholder="Phone number" />
      </div>
      <div>
        <label class="input-label">Address</label>
        <textarea class="input" id="pf-address" rows="2" placeholder="Address">${editParty?.address || ''}</textarea>
      </div>
      <div>
        <label class="input-label">Identity / ID Proof</label>
        <input class="input" id="pf-identity" value="${editParty?.identity || ''}" placeholder="Aadhar, PAN, etc." />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="input-label">Risk Category</label>
          <select class="input" id="pf-risk">
            ${['low', 'medium', 'high', 'critical'].map((r) =>
              `<option value="${r}" ${editParty?.riskCategory === r ? 'selected' : ''}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
        <div>
          <label class="input-label">Status</label>
          <select class="input" id="pf-status">
            ${['active', 'closed', 'defaulted'].map((s) =>
              `<option value="${s}" ${editParty?.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="input-label">Interest Rate (% per month)</label>
        <input class="input" id="pf-rate" type="number" step="0.1" value="${editParty?.interestRate || '0'}" placeholder="e.g. 2" />
      </div>
      <div>
        <label class="input-label">Notes</label>
        <textarea class="input" id="pf-notes" rows="2" placeholder="Optional notes">${editParty?.notes || ''}</textarea>
      </div>
    </div>
  `

  const result = await showModal({
    title: isEdit ? 'Edit Party' : 'Add Party',
    content,
    confirmText: isEdit ? 'Update' : 'Add',
    onConfirm: () => {
      const name = document.getElementById('pf-name')?.value.trim()
      if (!name) { showToast('Party name is required', 'error'); return false }
      return {
        name,
        phone: document.getElementById('pf-phone')?.value.trim() || '',
        address: document.getElementById('pf-address')?.value.trim() || '',
        identity: document.getElementById('pf-identity')?.value.trim() || '',
        riskCategory: document.getElementById('pf-risk')?.value || 'low',
        status: document.getElementById('pf-status')?.value || 'active',
        interestRate: parseFloat(document.getElementById('pf-rate')?.value) || 0,
        notes: document.getElementById('pf-notes')?.value.trim() || '',
        updatedAt: new Date().toISOString(),
      }
    },
  })

  if (!result || result === true) return

  if (isEdit) result._id = editParty._id

  await saveParty(result)
  logAction(isEdit ? 'update' : 'create', 'party', result._id || '', isEdit ? 'Updated party' : 'Created party')
  showToast(isEdit ? 'Party updated' : 'Party added')
  renderParties(container, navigate)
}
