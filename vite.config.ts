import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace 'lewden-ev-bom' with your actual GitHub repo name
export default defineConfig({
  plugins: [react()],
  base: '/LewdenEVBOM/',
})
