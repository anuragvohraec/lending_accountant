/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,html}'],
  theme: {
    extend: {
      colors: {
        vibgyor: {
          violet: '#8B5CF6',
          indigo: '#6366F1',
          blue: '#3B82F6',
          green: '#10B981',
          yellow: '#F59E0B',
          orange: '#F97316',
          red: '#EF4444',
        },
        primary: '#6366F1',
        'primary-dark': '#4F46E5',
        'primary-light': '#A5B4FC',
        surface: '#F8FAFC',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
