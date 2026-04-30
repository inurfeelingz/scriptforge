// frontend/postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    // Minify CSS in production builds
    ...(process.env.NODE_ENV === 'production' ? { cssnano: { preset: 'default' } } : {}),
  },
}