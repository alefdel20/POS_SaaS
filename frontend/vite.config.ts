import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.VITE_API_BASE_URL': JSON.stringify('https://pos-APIs-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me')
  }
})