const REMOTE_OR_INLINE_IMAGE = /^(?:https?:|data:|blob:)/i
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

export function resolveMarkdownImagePath(vaultRoot: string, notePath: string, imageSrc: string): string {
  const trimmedSrc = imageSrc.trim()
  if (!trimmedSrc || REMOTE_OR_INLINE_IMAGE.test(trimmedSrc)) return imageSrc

  const filePath = stripFileUrl(stripQueryAndHash(trimmedSrc))
  const decodedPath = decodePath(filePath)
  if (isAbsolutePath(decodedPath)) return normalizePath(decodedPath)

  const normalizedVaultRoot = normalizePath(vaultRoot.trim())
  if (!normalizedVaultRoot) return imageSrc

  const noteDirectory = dirname(normalizePath(notePath))
  return normalizePath([normalizedVaultRoot, noteDirectory, decodedPath].filter(Boolean).join('/'))
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.search(/[?#]/)
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

function stripFileUrl(value: string): string {
  if (!value.toLowerCase().startsWith('file://')) return value

  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return value.replace(/^file:\/\//i, '')
  }
}

function decodePath(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(value)
}

function dirname(value: string): string {
  const lastSlash = value.lastIndexOf('/')
  return lastSlash === -1 ? '' : value.slice(0, lastSlash)
}

function normalizePath(value: string): string {
  const isWindowsAbsolute = WINDOWS_ABSOLUTE_PATH.test(value)
  const normalized = value.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? '/' : ''
  const segments: string[] = []

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else if (!prefix && !isWindowsAbsolute) {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }

  const path = `${prefix}${segments.join('/')}`
  return isWindowsAbsolute ? path.replace(/^([a-zA-Z]):/, '$1:') : path
}

export function toMarkdownImagePreviewSrc(vaultRoot: string, notePath: string, imageSrc: string, convertFn: (path: string) => string): string {
  if (!imageSrc.trim() || REMOTE_OR_INLINE_IMAGE.test(imageSrc)) {
    return imageSrc
  }
  const absolutePath = resolveMarkdownImagePath(vaultRoot, notePath, imageSrc)
  return convertFn(absolutePath)
}
