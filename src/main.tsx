import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import './app/styles.css'
import './i18n'
import { applyInitialTheme } from './shared/theme'

applyInitialTheme({
  element: document.documentElement,
  localStorage: window.localStorage,
  systemPrefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
})

// Prevent browser's default Backspace navigation which can cause the app to hang/go blank
document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (!isInput && !target.isContentEditable) {
      e.preventDefault();
    }
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
