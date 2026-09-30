import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // API Express lama (port 3000) — frontend React ngobrol ke sini
      '/api': 'http://localhost:3000',
      '/config.js': 'http://localhost:3000',
      '/config.json': 'http://localhost:3000',
      '/farm': 'http://localhost:3000',
    },
  },
})
