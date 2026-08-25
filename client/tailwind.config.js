/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0a0d14',
        surface: {
          DEFAULT: '#111726',
          card: '#161d30',
          hover: '#1d263e',
          active: '#242f4c',
          border: '#263353',
          borderLight: '#34456e'
        },
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdbff',
          300: '#8ec3ff',
          400: '#599fff',
          500: '#3077ff',
          600: '#1b56f5',
          700: '#1441e1',
          800: '#1636b6',
          900: '#18318f',
          950: '#111e57',
        },
        rdp: '#3b82f6',
        ssh: '#10b981',
        vnc: '#f59e0b',
        danger: '#ef4444',
        success: '#10b981',
        warning: '#f59e0b',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          'SFMono-Regular',
          'Consolas',
          '"Liberation Mono"',
          'Menlo',
          'monospace'
        ]
      },
      boxShadow: {
        'card': '0 4px 20px -2px rgba(0, 0, 0, 0.45)',
        'glow': '0 0 20px -3px rgba(48, 119, 255, 0.35)',
        'glow-emerald': '0 0 20px -3px rgba(16, 185, 129, 0.35)',
      },
      borderRadius: {
        'xl': '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      }
    },
  },
  plugins: [],
}
