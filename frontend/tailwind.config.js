// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['"DM Mono"', 'Courier New', 'monospace'],
        serif: ['"DM Serif Display"', 'Georgia', 'serif'],
        mono:  ['"DM Mono"', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#c8b89a',
          hot:     '#e8c87a',
          dim:     '#888070',
        },
        surface: {
          DEFAULT: '#0d0d0d',
          raised:  '#111111',
          border:  '#1a1a1a',
          hover:   '#1e1e1e',
        },
      },
    },
  },
  plugins: [],
}
