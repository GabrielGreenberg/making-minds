import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { INTEGRITY_NOTICE } from './src/provenance/notice.ts'

// The integrity notice (task 034) as a comment at the top of every entry
// chunk of the production bundle. Prepended in generateBundle — after
// minification, which may drop a `/*! */` banner set through output.banner.
function integrityNotice(): Plugin {
  return {
    name: 'mm-integrity-notice',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          chunk.code = `/*! ${INTEGRITY_NOTICE.replace(/\*\//g, '* /')} */\n${chunk.code}`
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), integrityNotice()],
  base: process.env.VITE_BASE_PATH ?? '/making-minds/',
  // Honor an assigned port (parallel sessions run several dev servers).
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
})
