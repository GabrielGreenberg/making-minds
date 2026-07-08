import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider, AuthGate } from './auth'

// Routing starts inside <AuthGate> once a user exists — a deep link must not
// fire an unauthenticated openAssignment (see auth/AuthGate.tsx).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
