import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const cliPath = resolve('node_modules/@tauri-apps/cli/tauri.js')

const hasConfigArg = args.some(arg => arg === '--config' || arg === '-c' || arg.startsWith('--config='))
const shouldUseDevConfig = args[0] === 'dev' && !hasConfigArg
const tauriArgs = shouldUseDevConfig
  ? ['dev', '--config', 'src-tauri/tauri.dev.conf.json', ...args.slice(1)]
  : args

const child = spawn(process.execPath, [cliPath, ...tauriArgs], {
  stdio: 'inherit',
  env: process.env,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.exit(code ?? 1)
})
