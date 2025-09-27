/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3652AD',
        'primary-dark': '#280274',
        accent: '#E9A89B',
        'accent-dark': '#F3CCF3',
      },
    },
  },
  plugins: [],
}