/** @type {import('tailwindcss').Config} */

// Colours resolve through CSS custom properties (see frontend/src/index.css) so both
// themes share one source of truth: toggling `data-theme` on <html> re-tints the entire
// app without touching a single component. Each variable holds space-separated RGB
// channels, which keeps Tailwind's `/opacity` modifiers (e.g. `bg-accent/12`) working.
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surface ramp: 950 = page canvas … 600 = strongest border.
        carbon: {
          950: channel('--carbon-950'),
          900: channel('--carbon-900'),
          850: channel('--carbon-850'),
          800: channel('--carbon-800'),
          750: channel('--carbon-750'),
          700: channel('--carbon-700'),
          600: channel('--carbon-600'),
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
          green: channel('--accent-green'),
          energy: channel('--accent-energy'),
          muted: channel('--accent'),
        },
        energy: channel('--accent-energy'),
        fuel: channel('--fuel'),
        graphite: channel('--graphite'),
        onfuel: channel('--on-fuel'),
        onaccent: channel('--on-accent'),
        onbrand: channel('--on-brand'),
        live: channel('--hero-live'),
        onok: channel('--on-ok'),
        onwarn: channel('--on-warn'),
        ondanger: channel('--on-danger'),
        onenergy: channel('--on-energy'),
        scrim: channel('--scrim'),
        inset: channel('--inset'),
        ok: channel('--ok'),
        warn: channel('--warn'),
        danger: channel('--danger'),
        info: channel('--info'),
        // Brand ink panel — always dark in both themes (login split, showcase surfaces).
        panel: {
          DEFAULT: channel('--panel-ink'),
          deep: channel('--panel-deep'),
          raised: channel('--panel-raised'),
          line: channel('--panel-line'),
          text: channel('--panel-text'),
          muted: channel('--panel-muted'),
          dim: channel('--panel-dim'),
          accent: channel('--panel-accent'),
          energy: channel('--panel-energy'),
        },
        chart: {
          1: channel('--accent'),
          2: channel('--accent-green'),
          3: channel('--accent-energy'),
          4: channel('--info'),
          5: channel('--danger'),
        },
      },
      opacity: {
        4: '0.04',
        6: '0.06',
        8: '0.08',
        12: '0.12',
        14: '0.14',
        16: '0.16',
        18: '0.18',
        22: '0.22',
      },
      spacing: {
        8.5: '2.125rem',
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
      fontSize: {
        'stat-sm': ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.025em' }],
        stat: ['1.45rem', { lineHeight: '1.8rem', letterSpacing: '-0.03em' }],
        'stat-lg': ['1.825rem', { lineHeight: '2.15rem', letterSpacing: '-0.035em' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        focus: 'var(--shadow-focus)',
        pop: 'var(--shadow-pop)',
        glow: 'var(--shadow-glow)',
        'card-hover': 'var(--shadow-card-hover)',
        sheen: 'var(--card-sheen)',
      },
      borderRadius: {
        '2.5xl': '1.25rem',
        '3xl': '1.5rem',
        '4xl': '1.75rem',
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
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.975) translateY(3px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.5', transform: 'scale(0.92)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-in': 'slide-in 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-up': 'slide-up 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
