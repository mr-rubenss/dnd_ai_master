import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/700.css'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './theme/apply'
import { themeFromSearch } from './theme/registry'

// ?theme=<id> временно включает тему из реестра (посмотреть тему дизайнера на телефоне); нигде не сохраняется.
const previewTheme = themeFromSearch(window.location.search)
if (previewTheme) applyTheme(previewTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
