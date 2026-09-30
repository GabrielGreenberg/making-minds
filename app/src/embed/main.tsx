import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Stylesheet order as the app's (main.tsx): the page-surface tokens first,
// then the editor, the page surfaces, and the editor's frame. No KaTeX: the
// embed renders no statement.
import '../theme.css'
import '../index.css'
import '../pages.css'
import '../workbench.css'
import { EmbedApp } from './EmbedApp'

// The embeddable sandbox (embed.html): the editor for one example, for show on
// the course website. No health probe, no auth, no routing and no course
// backend — the sandbox needs none of them (storage/pageBackend.ts). The page
// keeps nothing: embed.html declares it ephemeral on its <html>, which
// persistence.ts reads before any module that keeps anything evaluates.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
)
