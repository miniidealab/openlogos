/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
    "./src/renderer/index.html",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0F172A',
        secondary: '#1E3A8A',
        cta: '#CA8A04',
        surface: '#FFFFFF',
        background: '#F8FAFC',
        text: '#020617',
        'text-muted': '#64748B',
      },
      fontFamily: {
        sans: ['Fira Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
