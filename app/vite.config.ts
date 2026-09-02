import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? '/making-minds/',
  // Honor an assigned port (parallel sessions run several dev servers).
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
})
