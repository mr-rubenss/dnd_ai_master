import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/700.css'
// Шрифты текста ведущего на выбор (src/theme/appearance.ts, MASTER_FONTS); файлы грузятся, только когда шрифт выбран.
import '@fontsource/pt-serif/400.css'
import '@fontsource/lora/400.css'
import '@fontsource/pt-sans/400.css'
import './index.css'
import App from './App.tsx'
import { consoleCapture } from './game/consoleCapture'
// Настройки оформления (и ?theme=<id>) уже применил скрипт в index.html; хранилище подхватывает их для панели.
import './theme/appearanceStore'

// Ошибки консоли — для тестового отчёта («Что-то не так»).
consoleCapture.install()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
