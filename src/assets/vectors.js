export function decorativeBg() {
  return `
    <svg class="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]" viewBox="0 0 400 800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8B5CF6"/><stop offset="25%" stop-color="#6366F1"/>
          <stop offset="50%" stop-color="#3B82F6"/><stop offset="75%" stop-color="#10B981"/>
          <stop offset="100%" stop-color="#F59E0B"/>
        </linearGradient>
        <linearGradient id="vg2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#F97316"/><stop offset="50%" stop-color="#EF4444"/><stop offset="100%" stop-color="#8B5CF6"/>
        </linearGradient>
      </defs>
      <circle cx="50" cy="200" r="180" fill="url(#vg1)"/>
      <circle cx="350" cy="500" r="250" fill="url(#vg2)"/>
      <path d="M0 400 Q100 300 200 400 T400 350" stroke="url(#vg1)" stroke-width="2" fill="none"/>
      <path d="M0 600 Q150 500 300 600 T400 550" stroke="url(#vg2)" stroke-width="2" fill="none"/>
    </svg>
  `
}

export function financeIllustration() {
  return `
    <svg class="w-48 h-48" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="70" width="140" height="100" rx="10" fill="url(#vibgyor-card)" opacity="0.15"/>
      <rect x="40" y="80" width="120" height="8" rx="4" fill="#6366F1" opacity="0.3"/>
      <rect x="40" y="96" width="80" height="6" rx="3" fill="#10B981" opacity="0.2"/>
      <rect x="40" y="110" width="100" height="6" rx="3" fill="#F59E0B" opacity="0.2"/>
      <rect x="40" y="124" width="60" height="6" rx="3" fill="#EF4444" opacity="0.2"/>
      <path d="M60 155 L80 140 L100 155 L120 140 L140 155 L140 165 L60 165Z" fill="#8B5CF6" opacity="0.15"/>
      <circle cx="100" cy="35" r="20" fill="#F97316" opacity="0.1"/>
      <path d="M95 30 L100 25 L105 30 L100 40Z" fill="#F97316" opacity="0.3"/>
      <path d="M85 35 Q100 20 115 35" stroke="#F97316" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.3" fill="none"/>
    </svg>
  `
}

export function moneyIllustration() {
  return `
    <svg class="w-40 h-40" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vibgyor-card" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#6366F1"/><stop offset="100%" stop-color="#8B5CF6"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="70" r="30" fill="#10B981" opacity="0.08"/>
      <text x="100" y="78" text-anchor="middle" font-size="24" fill="#10B981" opacity="0.3">₹</text>
      <rect x="40" y="110" width="120" height="65" rx="8" fill="#6366F1" opacity="0.08" stroke="#6366F1" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="100" y="140" text-anchor="middle" font-size="12" fill="#6366F1" opacity="0.2">PAYMENT</text>
      <circle cx="50" cy="50" r="6" fill="#F59E0B" opacity="0.2"/>
      <circle cx="160" cy="60" r="4" fill="#EF4444" opacity="0.15"/>
      <circle cx="20" cy="150" r="8" fill="#8B5CF6" opacity="0.1"/>
      <circle cx="180" cy="130" r="5" fill="#3B82F6" opacity="0.15"/>
    </svg>
  `
}

export function peopleIllustration() {
  return `
    <svg class="w-40 h-40" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="80" cy="70" r="22" fill="#8B5CF6" opacity="0.1"/>
      <ellipse cx="80" cy="115" rx="30" ry="22" fill="#8B5CF6" opacity="0.08"/>
      <circle cx="130" cy="75" r="18" fill="#6366F1" opacity="0.1"/>
      <ellipse cx="130" cy="110" rx="25" ry="18" fill="#6366F1" opacity="0.08"/>
      <path d="M40 160 Q100 130 160 160" stroke="#3B82F6" stroke-width="1.5" opacity="0.2" fill="none" stroke-dasharray="4 4"/>
    </svg>
  `
}
