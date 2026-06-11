import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('startup shell', () => {
  it('sets a dark fallback background before the app module loads', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
    const styleIndex = html.indexOf('id="inote-startup-theme"')
    const moduleIndex = html.indexOf('src="/src/main.tsx"')

    expect(styleIndex).toBeGreaterThan(-1)
    expect(moduleIndex).toBeGreaterThan(styleIndex)
    expect(html).toContain('background: #050606')
    expect(html).toContain('document.documentElement.dataset.theme')
  })

  it('keeps the native window hidden until the webview has a painted frame', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'))
    const [mainWindow] = config.app.windows

    expect(mainWindow.visible).toBe(false)
    expect(mainWindow.backgroundColor).toBe('#050606')
    expect(config['$schema']).toBe('https://schema.tauri.app/config/2')
  })

  it('reveals the hidden native window from Rust after the webview finishes loading', () => {
    const lib = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf8')

    expect(lib).toContain('.on_page_load(')
    expect(lib).toContain('PageLoadEvent::Finished')
    expect(lib).toContain('webview.window().show()')
  })
})
