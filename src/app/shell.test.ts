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
    expect(html).toContain('background: #1c1e1a')
    expect(html).toContain('document.documentElement.dataset.theme')
  })

  it('applies the stored color theme before the app module loads', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')

    expect(html).toContain('inote.colorTheme')
    expect(html).toContain("['default', 'forest', 'graphite', 'ember']")
    expect(html).toContain("colorTheme === 'default'")
    expect(html).not.toContain("['default', 'nord', 'sepia', 'ocean']")
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

  it('keeps markdown images within the editor content width', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.mdx-editor-wrapper .prose img')
    expect(styles).toContain('max-width: 100%')
    expect(styles).toContain('height: auto')
  })

  it('keeps the note card layout fixed and scrollable in the left sidebar', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(app).toMatch(/isActive \? ["']note-card active["'] : ["']note-card["']/)
    expect(app).toMatch(/noteListMode === ["']cards["'] \? ["']note-card-grid["']/)
    expect(app).toContain('minmax(0, 1fr)')
    expect(styles).toContain('grid-template-columns: repeat(auto-fill, 180px)')
    expect(styles).toContain('height: 206px')
  })

  it('keeps summary note titles from widening the left sidebar', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('className="w-full min-w-0 max-w-full"')
    expect(app).toContain('className="flex items-center justify-between gap-2 w-full min-w-0 max-w-full"')
    expect(app).toMatch(/className=\{`text-sm font-semibold truncate min-w-0 max-w-full/)
  })

  it('reserves native macOS traffic-light space in the title bar', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('pl-[82px]')
    expect(app).toContain('max-[900px]:pl-[74px]')
  })

  it('gates the title bar Today note button behind the settings toggle', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('{showTodayNoteButton ? (')
    expect(app).toMatch(/title=\{t\(["']settings\.todayNote["']\)\}/)
    expect(app).toContain(') : null}')
  })

  it('adds a general setting for auto-saving when the native window closes', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const settings = readFileSync(resolve(__dirname, '../features/settings/SettingsPanel.tsx'), 'utf8')

    expect(settings).toContain('autoSaveOnExit')
    expect(settings).toContain('settings.autoSaveOnExit')
    expect(app).toContain('onCloseRequested')
    expect(app).toContain('autoSaveOnExitRef.current')
    expect(app).toContain('saveActiveNoteRef.current()')
  })

  it('uses the primary color for the title bar create note button', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toMatch(/className=["']btn btn-ghost btn-sm btn-square["'][\s\S]*?type=["']button["'][\s\S]*?onClick=\{addCategoryNote\}/)
  })

  it('enables the Tauri asset protocol for local markdown images', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'))

    expect(config.app.security.assetProtocol).toMatchObject({
      enable: true,
      scope: expect.arrayContaining(['$HOME/**']),
    })
  })
})
