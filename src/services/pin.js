import { getSettings, saveSettings } from '../db/database.js'

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToArrayBuffer(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - s.length % 4) : ''
  return Uint8Array.from(atob(s + pad), c => c.charCodeAt(0)).buffer
}

export async function isLockEnabled() {
  const s = await getSettings()
  return !!(s.pin || s.webauthnCredentialId)
}

export async function webauthnAvailable() {
  try {
    return window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function setupWebAuthn() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: window.location.hostname, name: 'MunimJi' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'munimji-user',
        displayName: 'MunimJi User',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  })
  const s = await getSettings()
  s.webauthnCredentialId = base64url(cred.rawId)
  s.webauthnRpId = window.location.hostname
  s.pin = ''
  await saveSettings(s)
}

export async function authenticateWithWebAuthn() {
  const s = await getSettings()
  if (!s.webauthnCredentialId) return false
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{
          id: base64urlToArrayBuffer(s.webauthnCredentialId),
          type: 'public-key',
          transports: ['internal'],
        }],
        userVerification: 'required',
        timeout: 60000,
      },
    })
    return true
  } catch {
    return false
  }
}

export async function setPin(pin) {
  const s = await getSettings()
  s.pin = pin
  s.webauthnCredentialId = null
  s.webauthnRpId = null
  await saveSettings(s)
}

export async function verifyPin(pin) {
  const s = await getSettings()
  return s.pin === pin
}

export async function getLockMethod() {
  const s = await getSettings()
  if (s.webauthnCredentialId) return 'webauthn'
  if (s.pin) return 'pin'
  return null
}

export async function clearAuth() {
  const s = await getSettings()
  s.pin = ''
  s.webauthnCredentialId = null
  s.webauthnRpId = null
  await saveSettings(s)
}
