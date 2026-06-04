import { getSettings, saveSettings } from '../db/database.js'

export async function isPinSet() {
  const settings = await getSettings()
  return !!settings.pin
}

export async function setPin(pin) {
  const settings = await getSettings()
  settings.pin = pin
  await saveSettings(settings)
}

export async function verifyPin(pin) {
  const settings = await getSettings()
  return settings.pin === pin
}

export async function clearPin() {
  const settings = await getSettings()
  settings.pin = ''
  await saveSettings(settings)
}
