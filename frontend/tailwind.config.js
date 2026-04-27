// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Figtree', 'system-ui', 'sans-serif'],
        display: ['Syne', 'system-ui', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#d4a853',
          hot:     '#e8c87a',
          dim:     '#9a7830',
          glow:    'rgba(212,168,83,0.15)',
        },
        surface: {
          DEFAULT:  '#111118',
          2:        '#17171f',
          3:        '#1e1e28',
          border:   'rgba(255,255,255,0.07)',
          border2:  'rgba(255,255,255,0.13)',
        },
      },
      fontSize: {
        // Slightly larger base scale
        'xs':   ['0.75rem',    { lineHeight: '1.4' }],
        'sm':   ['0.8125rem',  { lineHeight: '1.5' }],
        'base': ['1rem',       { lineHeight: '1.6' }],
        'lg':   ['1.0625rem',  { lineHeight: '1.6' }],
        'xl':   ['1.25rem',    { lineHeight: '1.4' }],
        '2xl':  ['1.5rem',     { lineHeight: '1.3' }],
        '3xl':  ['1.875rem',   { lineHeight: '1.2' }],
      },
    },
  },
  plugins: [],
}