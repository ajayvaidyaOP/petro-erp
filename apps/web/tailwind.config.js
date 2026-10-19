/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#060b15',
          900: '#0a1120',
          850: '#0d1628',
          800: '#111c33',
          750: '#152340',
          700: '#1b2d4d',
          600: '#27405f',
        },
        ink: {
          100: '#eef4ff',
          200: '#d6e2f5',
          300: '#b3c5df',
          400: '#8ba0bf',
          500: '#6b81a3',
        },
        accent: {
          DEFAULT: '#38bdf8',
          soft: '#0ea5e9',
          teal: '#2dd4bf',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(2, 6, 23, 0.5), 0 8px 24px -16px rgba(2, 6, 23, 0.9)',
        focus: '0 0 0 3px rgba(56, 189, 248, 0.22)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in': 'slide-in 180ms ease-out',
      },
    },
  },
  plugins: [],
};
