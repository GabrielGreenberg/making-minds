import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
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
