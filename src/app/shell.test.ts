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

  it('keeps the native About version aligned with the application version', () => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
    const tauriConfig = JSON.parse(readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'))
    const cargoToml = readFileSync(resolve(__dirname, '../../src-tauri/Cargo.toml'), 'utf8')

    expect(packageJson.version).toBe('0.12.0')
    expect(tauriConfig.version).toBe(packageJson.version)
    expect(cargoToml).toContain(`version = "${packageJson.version}"`)
  })

  it('keeps markdown images within the editor content width', () => {
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(styles).toContain('.mdx-editor-wrapper .prose img')
    expect(styles).toContain('max-width: 100%')
    expect(styles).toContain('height: auto')
  })

  it('keeps the note card layout fixed and scrollable in the left sidebar', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const items = readFileSync(resolve(__dirname, './components/NoteListItems.tsx'), 'utf8')
    const panel = readFileSync(resolve(__dirname, './components/NoteListPanel.tsx'), 'utf8')
    const styles = readFileSync(resolve(__dirname, './styles.css'), 'utf8')

    expect(items).toMatch(/isActive \? ["']note-card active["'] : ["']note-card["']/)
    expect(panel).toMatch(/noteListMode === ["']cards["'] \? ["']note-card-grid["']/)
    expect(app).toContain('minmax(0, 1fr)')
    expect(styles).toContain('grid-template-columns: repeat(auto-fill, 180px)')
    expect(styles).toContain('height: 206px')
  })

  it('keeps summary note titles from widening the left sidebar', () => {
    const app = readFileSync(resolve(__dirname, './components/NoteListItems.tsx'), 'utf8')

    expect(app).toContain('className="w-full min-w-0 max-w-full"')
    expect(app).toContain('className="flex items-center justify-between gap-2 w-full min-w-0 max-w-full"')
    expect(app).toMatch(/className=\{`text-sm font-semibold truncate min-w-0 max-w-full/)
  })

  it('reserves native macOS traffic-light space in the title bar', () => {
    const app = readFileSync(resolve(__dirname, './components/TitleBar.tsx'), 'utf8')

    expect(app).toContain('pl-[82px]')
    expect(app).toContain('max-[900px]:pl-[74px]')
  })

  it('gates the title bar Today note button behind the settings toggle', () => {
    const app = readFileSync(resolve(__dirname, './components/TitleBar.tsx'), 'utf8')

    expect(app).toContain('{props.showTodayNoteButton ? (')
    expect(app).toMatch(/title=\{t\(["']settings\.todayNote["']\)\}/)
    expect(app).toContain(') : null}')
  })

  it('provides browser-style note history navigation in the title bar', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('const [noteHistory, setNoteHistory] = useState<string[]>([])')
    expect(app).toContain('...current.slice(0, noteHistoryIndex + 1)')
    expect(app).toContain('navigateNoteHistory(previousHistoryIndex)')
    expect(app).toContain('navigateNoteHistory(nextHistoryIndex)')
    const titleBar = readFileSync(resolve(__dirname, './components/TitleBar.tsx'), 'utf8')
    expect(titleBar.match(/disabled:text-base-content\/20/g)).toHaveLength(2)
    expect(titleBar.match(/disabled:opacity-40/g)).toHaveLength(2)
    expect(app).not.toContain('notePosition')
  })

  it('places the iNote brand directly after the macOS traffic-light space', () => {
    const app = readFileSync(resolve(__dirname, './components/TitleBar.tsx'), 'utf8')

    const header = app.slice(app.indexOf('<header'), app.indexOf('</header>'))
    expect(header.indexOf('iNote')).toBeLessThan(header.indexOf('<PanelLeft'))
    expect(header.indexOf('props.vaultName')).toBeLessThan(header.indexOf('<PanelLeft'))
    expect(header).toContain('flex-col items-start')
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

  it('quits the app process after handling the native close request', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const api = readFileSync(resolve(__dirname, '../shared/api.ts'), 'utf8')
    const commands = readFileSync(resolve(__dirname, '../../src-tauri/src/commands.rs'), 'utf8')
    const lib = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf8')

    expect(app).toContain('quitApp')
    expect(app).toContain('event.preventDefault()')
    expect(app).toContain('await quitApp()')
    expect(app).not.toContain('await appWindow.destroy()')
    expect(api).toContain("invoke<void>('quit_app')")
    expect(commands).toContain('pub fn quit_app')
    expect(lib).toContain('commands::quit_app')
  })

  it('uses the accent color for the title bar create note button and groups other create actions', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const titleBar = readFileSync(resolve(__dirname, './components/TitleBar.tsx'), 'utf8')

    expect(app).toContain('onCreateNote={() => void addCategoryNote()}')
    expect(titleBar).toMatch(/onClick=\{onCreateNote\}[\s\S]*?<Plus size=\{18\} className="text-accent" \/>/)
    expect(titleBar).toContain('role="menu"')
    expect(titleBar).toContain('onClick={run(onCreateMindMap)}')
    expect(titleBar).toContain('onClick={run(onCreateFolder)}')
  })

  it('enables the Tauri asset protocol for local markdown images', () => {
    const config = JSON.parse(readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'))

    expect(config.app.security.assetProtocol).toMatchObject({
      enable: true,
      scope: [],
    })
    expect(config.app.security.csp).toContain("object-src 'none'")
  })

  it('stores pasted images as local assets instead of embedding them in markdown', () => {
    const editor = readFileSync(resolve(__dirname, '../features/editor/Editor.tsx'), 'utf8')
    const api = readFileSync(resolve(__dirname, '../shared/api.ts'), 'utf8')
    const commands = readFileSync(resolve(__dirname, '../../src-tauri/src/commands.rs'), 'utf8')
    const lib = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf8')

    expect(editor).toContain('return saveNoteImage({')
    expect(api).toContain("invoke<string>('save_note_image'")
    expect(commands).toContain('pub fn save_note_image')
    expect(lib).toContain('commands::save_note_image')
  })

  it('does not reload note links for every body edit', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('const activeNotePath = activeNote?.path')
    expect(app).toContain('[activeNotePath, linkVersion, vaultRoot]')
    expect(app).not.toContain('[activeNote, linkVersion, vaultRoot]')
  })

  it('restores the cached vault before checking the disk in the background', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const api = readFileSync(resolve(__dirname, '../shared/api.ts'), 'utf8')
    const commands = readFileSync(resolve(__dirname, '../../src-tauri/src/commands.rs'), 'utf8')
    const lib = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf8')

    expect(app).toContain('cachedNotes = await loadIndexedVault(trimmedRoot)')
    expect(app).toContain('await loadVaultFromDisk(trimmedRoot, reason, preferredPath)')
    expect(api).toContain("invoke<Note[] | null>('load_indexed_vault'")
    expect(commands).toContain('pub fn load_indexed_vault')
    expect(lib).toContain('commands::load_indexed_vault')
  })

  it('paints the workspace before mounting a heavy note editor', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')

    expect(app).toContain('window.requestAnimationFrame')
    expect(app).toContain('!editorPaintReady')
    expect(app).toContain('<Skeleton variant="editor" label={t("loading.note")} />')
  })

  it('migrates legacy base64 note images before mounting the editor', () => {
    const app = readFileSync(resolve(__dirname, './App.tsx'), 'utf8')
    const api = readFileSync(resolve(__dirname, '../shared/api.ts'), 'utf8')
    const commands = readFileSync(resolve(__dirname, '../../src-tauri/src/commands.rs'), 'utf8')

    expect(app).toContain('await migrateNoteImages({')
    expect(app).toContain('t("loading.migratingImages")')
    expect(api).toContain("invoke<Note | null>('migrate_note_images'")
    expect(commands).toContain('pub fn migrate_note_images')
  })
})
