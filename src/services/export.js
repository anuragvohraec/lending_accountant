import { getAllData, importAllData, saveSettings, getSettings } from '../db/database.js'

export async function exportBackup() {
  const data = await getAllData()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lending-backup-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
  const settings = await getSettings()
  settings.lastBackup = new Date().toISOString()
  await saveSettings(settings)
}

export async function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.sources || !data.parties || !data.transactions) {
          reject(new Error('Invalid backup file format'))
          return
        }
        await importAllData(data)
        resolve({ count: data.parties.length + data.sources.length + data.transactions.length + (data.collaterals?.length || 0) })
      } catch (err) {
        reject(new Error('Invalid backup file: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
