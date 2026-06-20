import { getBooks, getAllNotes, getBook, saveBook, deleteBook, getNotes, getNote, saveNote, deleteNote } from '../services/notebook.js'
import { showConfirm } from '../components/Modal.js'

let state = { view: 'books', bookId: null, noteId: null }
let mainEl = null

export async function renderNotebook(main) {
  mainEl = main
  state = { view: 'books', bookId: null, noteId: null }
  await renderBooks()
}

async function renderBooks() {
  state.view = 'books'
  const [books, allNotes] = await Promise.all([getBooks(), getAllNotes()])
  const noteCounts = {}
  allNotes.forEach(n => { noteCounts[n.bookId] = (noteCounts[n.bookId] || 0) + 1 })
  mainEl.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Books</h2>
      <button id="nb-new-book" class="btn-primary text-sm px-3 py-1.5">+ New Book</button>
    </div>
    <div id="nb-books-list" class="space-y-2">
      ${books.length === 0 ? '<p class="text-sm text-gray-400 text-center py-8">No books yet. Tap "+ New Book" to start.</p>' :
        books.map(b => `
          <div class="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer active:bg-gray-50" data-book-id="${b._id}">
            <div class="flex-1 min-w-0">
              <div class="font-semibold text-gray-900 truncate">${esc(b.name)}</div>
              <div class="text-xs text-gray-400 mt-0.5">${noteCounts[b._id] || 0} notes</div>
            </div>
            <button class="btn-icon btn-ghost text-gray-400 -mr-2 nb-del-book" data-book-id="${b._id}"><ion-icon name="trash-outline" class="text-lg"></ion-icon></button>
          </div>
        `).join('')}
    </div>
  `

  document.getElementById('nb-new-book').addEventListener('click', promptNewBook)
  mainEl.querySelectorAll('[data-book-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.nb-del-book')) return
      openBook(el.dataset.bookId)
    })
  })
  mainEl.querySelectorAll('.nb-del-book').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      promptDeleteBook(btn.dataset.bookId)
    })
  })
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

async function promptNewBook() {
  const name = prompt('Book name:')
  if (!name || !name.trim()) return
  await saveBook({ name: name.trim() })
  await renderBooks()
}

async function promptDeleteBook(bookId) {
  const confirmed = await showConfirm({ title: 'Delete Book', message: 'Delete this book and all its notes?', confirmText: 'Delete', danger: true })
  if (!confirmed) return
  await deleteBook(bookId)
  await renderBooks()
}

async function openBook(bookId) {
  state.bookId = bookId
  state.view = 'notes'
  const book = await getBook(bookId).catch(() => null)
  if (!book) { await renderBooks(); return }
  const notes = await getNotes(bookId)
  mainEl.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <button id="nb-back-books" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
      <h2 class="text-lg font-bold truncate flex-1 text-center">${esc(book.name)}</h2>
      <button id="nb-new-note" class="btn-primary text-sm px-3 py-1.5">+ Note</button>
    </div>
    <input id="nb-search" class="input mb-3 text-sm" placeholder="Search notes..." autocomplete="off">
    <div id="nb-notes-list" class="space-y-1">
      ${renderNoteItems(notes)}
    </div>
  `

  document.getElementById('nb-back-books').addEventListener('click', () => renderBooks())
  document.getElementById('nb-new-note').addEventListener('click', () => openEditor(bookId, null))

  document.getElementById('nb-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim()
    const filtered = q ? notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (stripHtml(n.content || '')).toLowerCase().includes(q)
    ) : notes
    document.getElementById('nb-notes-list').innerHTML = renderNoteItems(filtered)
  })

  mainEl.querySelectorAll('[data-note-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.nb-del-note')) return
      openEditor(bookId, el.dataset.noteId)
    })
  })
  mainEl.querySelectorAll('.nb-del-note').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const confirmed = await showConfirm({ title: 'Delete Note', message: 'Are you sure you want to delete this note?', confirmText: 'Delete', danger: true })
      if (!confirmed) return
      await deleteNote(btn.dataset.noteId)
      await openBook(bookId)
    })
  })
}

function renderNoteItems(notes) {
  return notes.length === 0 ? '<p class="text-sm text-gray-400 text-center py-8">No notes yet.</p>' :
    notes.map(n => `
      <div class="bg-white rounded-xl px-4 py-3 shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer active:bg-gray-50" data-note-id="${n._id}">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-gray-900 text-sm truncate">${esc(n.title || 'Untitled')}</div>
          <div class="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
            <span class="truncate overflow-hidden">${esc(stripHtml(n.content || '').slice(0, 80)) || 'Empty'}</span>
            <span class="shrink-0">${fmtDate(n.updatedAt)}</span>
          </div>
        </div>
        <button class="btn-icon btn-ghost text-gray-400 -mr-2 nb-del-note shrink-0" data-note-id="${n._id}"><ion-icon name="trash-outline" class="text-lg"></ion-icon></button>
      </div>
    `).join('')
}

function stripHtml(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || d.innerText || ''
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today'
  if (diff < 172800000) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

async function openEditor(bookId, noteId) {
  state.view = 'editor'
  state.noteId = noteId
  let note = { title: '', content: '' }
  if (noteId) {
    try { note = await getNote(noteId) } catch {}
  }

  mainEl.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <button id="nb-back-notes" class="btn-icon btn-ghost -ml-1"><ion-icon name="arrow-back-outline" class="text-xl"></ion-icon></button>
      <h2 class="text-base font-bold truncate flex-1 text-center">${noteId ? 'Edit Note' : 'New Note'}</h2>
      <button id="nb-save-note" class="text-sm font-semibold text-primary">Save</button>
    </div>
    <input id="nb-note-title" class="w-full text-lg font-bold bg-transparent border-0 outline-none mb-3 placeholder-gray-300" placeholder="Note title" value="${esc(note.title || '')}" autocomplete="off">
    <div id="nb-editor-toolbar" class="flex items-center gap-1 p-1.5 bg-gray-50 rounded-xl mb-2 sticky top-0 z-10 overflow-x-auto">
      <button class="nb-tool-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
      <button class="nb-tool-btn" data-cmd="italic" title="Italic"><em>I</em></button>
      <button class="nb-tool-btn" data-cmd="underline" title="Underline"><u>U</u></button>
      <span class="w-px h-5 bg-gray-200 mx-0.5 shrink-0"></span>
      <button class="nb-tool-btn" data-cmd="heading" title="Heading">H</button>
      <span class="w-px h-5 bg-gray-200 mx-0.5 shrink-0"></span>
      <button class="nb-tool-btn" data-cmd="insertUnorderedList" title="Bullet list"><ion-icon name="list-outline" class="text-base"></ion-icon></button>
      <button class="nb-tool-btn" data-cmd="insertOrderedList" title="Numbered list"><ion-icon name="list" class="text-base"></ion-icon></button>
      <span class="w-px h-5 bg-gray-200 mx-0.5 shrink-0"></span>
      <button class="nb-tool-btn" data-cmd="image" title="Add image"><ion-icon name="image-outline" class="text-base"></ion-icon></button>
      <button class="nb-tool-btn relative" data-cmd="color" title="Text color">
        <ion-icon name="color-palette-outline" class="text-base"></ion-icon>
        <input type="color" id="nb-color-picker" class="absolute inset-0 opacity-0 w-full h-full cursor-pointer" value="#000000">
      </button>
      <button class="nb-tool-btn" data-cmd="hr" title="Divider"><ion-icon name="remove-outline" class="text-base"></ion-icon></button>
      <span class="w-px h-5 bg-gray-200 mx-0.5 shrink-0"></span>
      <button class="nb-tool-btn" data-cmd="redo" title="Redo"><span class="text-sm">↷</span> <span class="text-[10px]">Redo</span></button>
      <button class="nb-tool-btn" data-cmd="undo" title="Undo"><span class="text-sm">↶</span> <span class="text-[10px]">Undo</span></button>
    </div>
    <div id="nb-editor" class="min-h-[40vh] bg-white rounded-xl border border-gray-200 p-4 text-sm leading-relaxed outline-none focus:border-primary whitespace-pre-wrap" contenteditable="true">${note.content || ''}</div>
    <input type="file" id="nb-image-input" accept="image/*" class="hidden">
  `

  const editor = document.getElementById('nb-editor')
  const titleInput = document.getElementById('nb-note-title')
  const backBtn = document.getElementById('nb-back-notes')
  const saveBtn = document.getElementById('nb-save-note')

  async function saveCurrent() {
    const title = titleInput.value.trim() || 'Untitled'
    const content = editor.innerHTML
    await saveNote({ _id: noteId || undefined, bookId, title, content })
  }

  backBtn.addEventListener('click', async () => {
    await saveCurrent()
    await openBook(bookId)
  })

  saveBtn.addEventListener('click', async () => {
    await saveCurrent()
    await openBook(bookId)
  })

  let savedRange = null

  mainEl.querySelectorAll('.nb-tool-btn').forEach(btn => {
    if (btn.dataset.cmd === 'color') return

    btn.addEventListener('pointerdown', () => {
      const sel = window.getSelection()
      if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0)
      }
    })

    btn.addEventListener('click', () => {
      if (savedRange) {
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(savedRange)
      }
      editor.focus()

      const cmd = btn.dataset.cmd
      if (cmd === 'image') {
        document.getElementById('nb-image-input').click()
      } else if (cmd === 'heading') {
        const current = document.queryCommandValue('formatBlock')
        const tags = ['h1', 'h2', 'h3', 'p']
        const idx = tags.indexOf(current)
        const next = tags[(idx + 1) % tags.length]
        document.execCommand('formatBlock', false, `<${next}>`)
      } else if (cmd === 'hr') {
        document.execCommand('insertHorizontalRule')
      } else {
        document.execCommand(cmd, false, null)
      }
    })
  })

  document.getElementById('nb-color-picker').addEventListener('input', (e) => {
    if (savedRange) {
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(savedRange)
    }
    editor.focus()
    document.execCommand('foreColor', false, e.target.value)
  })

  document.getElementById('nb-color-picker').addEventListener('pointerdown', () => {
    const sel = window.getSelection()
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0)
    }
  })

  document.getElementById('nb-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      editor.focus()
      document.execCommand('insertImage', false, ev.target.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  })
}
