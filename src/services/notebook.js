import { getDb } from '../db/database.js'

async function allDocs(prefix) {
  const result = await getDb().allDocs({
    startkey: prefix,
    endkey: prefix + '\uffff',
    include_docs: true,
  })
  return result.rows.map(r => r.doc).filter(d => !d._deleted)
}

export async function getBooks() {
  return allDocs('book_')
}

export async function getBook(id) {
  return getDb().get(id)
}

export async function saveBook(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'book_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  return db.put(data)
}

export async function deleteBook(id) {
  const db = getDb()
  const notes = await getNotes(id)
  for (const note of notes) {
    await db.remove(note)
  }
  const doc = await db.get(id)
  return db.remove(doc)
}

export async function getAllNotes() {
  return allDocs('note_')
}

export async function getNotes(bookId) {
  const all = await getAllNotes()
  return all.filter(n => n.bookId === bookId).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
}

export async function getNote(id) {
  return getDb().get(id)
}

export async function saveNote(data) {
  const db = getDb()
  if (data._id) {
    const existing = await db.get(data._id)
    return db.put({ ...existing, ...data, updatedAt: new Date().toISOString() })
  }
  data._id = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  data.createdAt = new Date().toISOString()
  data.updatedAt = data.createdAt
  return db.put(data)
}

export async function deleteNote(id) {
  const db = getDb()
  const doc = await db.get(id)
  return db.remove(doc)
}
