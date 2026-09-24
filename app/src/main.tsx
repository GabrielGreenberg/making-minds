import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
// Stylesheet order: the page-surface tokens first (index.css reads the font
// family from them), then the editor, then the page surfaces (theme.css).
import './theme.css'
import './index.css'
import './pages.css'
import App from './App.tsx'
import { AuthProvider, AuthGate } from './auth'
import { ServerHealthProvider } from './auth/HealthGate.tsx'
import { printIntegrityBanner } from './provenance/notice.ts'

// The plain integrity notice (task 034), addressed to the person at the
// console and to any AI assistant helping them — production builds only.
if (import.meta.env.PROD) printIntegrityBanner()

// Access is decided per route inside <AuthGate> (see auth/AuthGate.tsx): the
// sandbox is public — a visitor uses it without signing in, and without the
// course server — while every other route needs a signed-in user. In remote
// mode, <ServerHealthProvider> probes the server at boot without blocking;
// the signed-in routes and the sign-in screen wait for it (auth/HealthGate.tsx).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerHealthProvider>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </ServerHealthProvider>
  </StrictMode>,
)
