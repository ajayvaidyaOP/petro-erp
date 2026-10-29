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
        // (Names stay `navy-*` for continuity; the hue is now green-graphite, not blue.)
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
          // Amber-gold "fuel / energy / money-in" highlight. Use sparingly: rates,
          // litres, positive revenue moments — never for whole surfaces.
          energy: channel('--accent-energy'),
          muted: channel('--accent'),
        },
        energy: channel('--accent-energy'),
        // Foreground for text sitting on a brand- or status-coloured surface.
        onaccent: channel('--on-accent'),
        onok: channel('--on-ok'),
        onwarn: channel('--on-warn'),
        ondanger: channel('--on-danger'),
        onenergy: channel('--on-energy'),
        // Modal / drawer backdrop — always dark in both themes.
        scrim: channel('--scrim'),
        // Recessed surface for telemetry readouts, code blocks and inset wells.
        inset: channel('--inset'),
        // Semantic status colours that invert legibly across light and dark themes.
        ok: channel('--ok'),
        warn: channel('--warn'),
        danger: channel('--danger'),
        info: channel('--info'),
        // Brand ink panel — always dark in both themes (login split, marketing blocks).
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
        // Chart series (also mirrored in lib/theme.tsx for Recharts SVG attributes).
        chart: {
          1: channel('--accent'),
          2: channel('--accent-teal'),
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
        // Display sizes for KPI values: tighter tracking the bigger it gets.
        'stat-sm': ['1.0625rem', { lineHeight: '1.45rem', letterSpacing: '-0.02em' }],
        stat: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.025em' }],
        'stat-lg': ['1.75rem', { lineHeight: '2.1rem', letterSpacing: '-0.03em' }],
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
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-in': 'slide-in 160ms ease-out',
        'scale-in': 'scale-in 130ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2.4s ease-in-out infinite',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
