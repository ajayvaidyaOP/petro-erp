/** @type {import('tailwindcss').Config} */

// Colours resolve through CSS custom properties so both themes share one source
// of truth: toggling `data-theme` on <html> re-tints the entire app without
// touching a single component. Each variable holds space-separated RGB channels,
// which keeps Tailwind's `/opacity` modifiers (e.g. `bg-accent/12`) working.
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surface ramp: 950 = page canvas … 600 = strongest steel-blue border.
        navy: {
          950: channel('--navy-950'),
          900: channel('--navy-900'),
          850: channel('--navy-850'),
          800: channel('--navy-800'),
          750: channel('--navy-750'),
          700: channel('--navy-700'),
          600: channel('--navy-600'),
        },
        // Text ramp: 100 = strongest … 600 = faintest.
        ink: {
          100: channel('--ink-100'),
          200: channel('--ink-200'),
          300: channel('--ink-300'),
          400: channel('--ink-400'),
          500: channel('--ink-500'),
          600: channel('--ink-600'),
        },
        accent: {
          DEFAULT: channel('--accent'),
          soft: channel('--accent-soft'),
          teal: channel('--accent-teal'),
          muted: channel('--accent'),
        },
        // Foreground for text sitting on a brand-coloured surface.
        onaccent: channel('--on-accent'),
        // Modal / drawer backdrop — always dark in both themes.
        scrim: channel('--scrim'),
        // Recessed surface for telemetry readouts, code blocks and inset wells.
        inset: channel('--inset'),
        // Semantic status colours that invert legibly across light and dark themes.
        ok: channel('--ok'),
        warn: channel('--warn'),
        danger: channel('--danger'),
        info: channel('--info'),
      },
      opacity: {
        6: '0.06',
        8: '0.08',
        12: '0.12',
        14: '0.14',
        16: '0.16',
        18: '0.18',
        22: '0.22',
      },
      spacing: {
        9.5: '2.375rem',
      },
      fontFamily: {
        display: ['Manrope Variable', 'Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: [
          'Inter Variable',
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
        card: 'var(--shadow-card)',
        focus: 'var(--shadow-focus)',
        pop: 'var(--shadow-pop)',
        glow: 'var(--shadow-glow)',
      },
      borderRadius: {
        '4xl': '1.75rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(3px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(10px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-in': 'slide-in 160ms ease-out',
        'scale-in': 'scale-in 130ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
