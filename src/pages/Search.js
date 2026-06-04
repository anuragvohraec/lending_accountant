import { getParties, getAllTransactions, getCollaterals } from '../db/database.js'
import { formatCurrencyFull, formatDate } from '../utils/formatters.js'
import { renderHeader } from '../components/Header.js'
import { showToast } from '../components/Toast.js'

let searchIndex = []
let allParties = []
let allTxns = []
let allCollaterals = []

export async function renderSearch(container, navigate) {
  renderHeader('Search')

  container.innerHTML = `
    <div class="slide-up">
      <div class="relative mb-4">
        <ion-icon name="search-outline" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></ion-icon>
        <input class="input pl-10 pr-10" id="global-search" placeholder="Search parties, notes, serial numbers..." autofocus />
        <button class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hidden" id="search-clear">
          <ion-icon name="close-outline" class="text-lg"></ion-icon>
        </button>
      </div>
      <div id="search-results" class="space-y-1"></div>
      <div id="search-recent" class="card">
        <h3 class="font-semibold text-sm mb-2">Recent Parties</h3>
        <div id="recent-parties"></div>
      </div>
    </div>
  `

  const [parties, txns, collaterals] = await Promise.all([getParties(), getAllTransactions(), getCollaterals()])
  allParties = parties
  allTxns = txns
  allCollaterals = collaterals

  buildSearchIndex()
  renderRecentParties(navigate)

  const input = document.getElementById('global-search')
  const clearBtn = document.getElementById('search-clear')

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim()
    clearBtn.classList.toggle('hidden', !q)
    if (q.length < 2) {
      document.getElementById('search-results').innerHTML = ''
      document.getElementById('search-recent').classList.remove('hidden')
      return
    }
    document.getElementById('search-recent').classList.add('hidden')
    performSearch(q, navigate)
  })

  clearBtn.addEventListener('click', () => {
    input.value = ''
    input.focus()
    clearBtn.classList.add('hidden')
    document.getElementById('search-results').innerHTML = ''
    document.getElementById('search-recent').classList.remove('hidden')
  })
}

function buildSearchIndex() {
  searchIndex = []
  allParties.forEach((p) => {
    searchIndex.push({
      id: p._id,
      type: 'party',
      title: p.name,
      subtitle: p.phone || p.identity || '',
      keywords: [p.name, p.phone, p.identity, p.notes, p.address].filter(Boolean).map((s) => s.toLowerCase()),
    })
  })
  allCollaterals.forEach((c) => {
    const p = allParties.find((x) => x._id === c.partyId)
    searchIndex.push({
      id: c._id,
      type: 'collateral',
      title: c.description || c.type,
      subtitle: p?.name || 'Unknown',
      partyId: c.partyId,
      keywords: [c.description, c.serialNumber, c.notes, c.type].filter(Boolean).map((s) => s.toLowerCase()),
    })
  })
  allTxns.forEach((t) => {
    const p = allParties.find((x) => x._id === t.partyId)
    searchIndex.push({
      id: t._id,
      type: 'transaction',
      title: (t.type === 'debit' ? 'Given: ' : 'Returned: ') + formatCurrencyFull(t.amount),
      subtitle: p?.name || 'Unknown',
      partyId: t.partyId,
      keywords: [t.notes, t.tags, p?.name, String(t.amount)].filter(Boolean).map((s) => s.toLowerCase()),
    })
  })
}

function performSearch(query, navigate) {
  const q = query.toLowerCase()
  const results = searchIndex.filter((item) =>
    item.keywords.some((k) => k.includes(q))
  ).slice(0, 30)

  const container = document.getElementById('search-results')
  if (results.length === 0) {
    container.innerHTML = '<div class="text-center py-12 text-gray-400 text-sm">No results found</div>'
    return
  }

  container.innerHTML = results.map((r) => {
    const icons = { party: 'person-outline', collateral: 'shield-outline', transaction: 'receipt-outline' }
    return `
      <div class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 cursor-pointer active:bg-gray-100 search-result" data-id="${r.id}" data-type="${r.type}" data-party-id="${r.partyId || ''}">
        <ion-icon name="${icons[r.type] || 'document-outline'}" class="text-gray-400 text-lg shrink-0"></ion-icon>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${r.title}</div>
          <div class="text-xs text-gray-400 truncate">${r.subtitle}</div>
        </div>
        <span class="text-[10px] capitalize text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">${r.type}</span>
      </div>
    `
  }).join('')

  container.querySelectorAll('.search-result').forEach((el) => {
    el.addEventListener('click', () => {
      const type = el.dataset.type
      if (type === 'party') navigate('party-detail', { id: el.dataset.id })
      else if (type === 'collateral' || type === 'transaction') navigate('party-detail', { id: el.dataset.partyId })
    })
  })
}

function renderRecentParties(navigate) {
  const el = document.getElementById('recent-parties')
  const recent = allParties.filter((p) => p.status === 'active').slice(0, 10)
  if (recent.length === 0) {
    el.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No parties yet</p>'
    return
  }
  el.innerHTML = recent.map((p) => `
    <div class="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-gray-50 cursor-pointer active:bg-gray-100 recent-party" data-id="${p._id}">
      <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary/10 to-vibgyor-violet/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
        ${(p.name || '?').charAt(0).toUpperCase()}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate">${p.name}</div>
        <div class="text-xs text-gray-400">${p.phone || ''}</div>
      </div>
      <ion-icon name="chevron-forward-outline" class="text-gray-300 text-sm"></ion-icon>
    </div>
  `).join('')

  el.querySelectorAll('.recent-party').forEach((item) => {
    item.addEventListener('click', () => navigate('party-detail', { id: item.dataset.id }))
  })
}
