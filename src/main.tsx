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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
