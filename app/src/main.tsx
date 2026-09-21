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
import { HealthGate } from './auth/HealthGate.tsx'

// Routing starts inside <AuthGate> once a user exists — a deep link must not
// fire an unauthenticated openAssignment (see auth/AuthGate.tsx). In remote
// mode, <HealthGate> holds everything (including session restore and the
// login form) until the server's health probe answers; a down server shows a
// retry screen instead of a white screen (see auth/HealthGate.tsx).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HealthGate>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </HealthGate>
  </StrictMode>,
)
