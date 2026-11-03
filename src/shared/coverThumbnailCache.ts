const memory = new Map<string, { data: string; time: number }>()
const pending = new Map<string, Promise<string | null>>()
const TTL = 5 * 60 * 1000
let dbPromise: Promise<IDBDatabase | null> | undefined
function database() {
  return dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open('inote-card-covers', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('thumbnails')
      request.onsuccess = () => resolve(request.result)
      request.onerror = request.onblocked = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function cached(key: string) {
  const db = await database()
  if (!db) return null
  return new Promise<{ data: string; time: number } | null>((resolve) => {
    try {
      const request = db.transaction('thumbnails').objectStore('thumbnails').get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function store(key: string, entry: { data: string; time: number }) {
  const db = await database()
  if (!db) return
  try {
    const tx = db.transaction('thumbnails', 'readwrite'), table = tx.objectStore('thumbnails')
    table.put(entry, key)
    const request = table.count()
    request.onsuccess = () => {
      if (request.result <= 128) return
      let excess = request.result - 128
      const cursor = table.openCursor()
      cursor.onsuccess = () => {
        if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue() }
      }
    }
  } catch { /* Memory cache remains available when persistent storage is blocked. */ }
}
let active = 0
const waiting: (() => void)[] = []
async function resize(source: string): Promise<string | null> {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  try {
    return await new Promise((resolve) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.referrerPolicy = 'no-referrer'
      const timer = window.setTimeout(() => { image.src = ''; resolve(null) }, 10000)
      image.onerror = () => { clearTimeout(timer); resolve(null) }
      image.onload = () => {
        clearTimeout(timer)
        try {
          const scale = Math.min(1, 320 / image.naturalWidth, 200 / image.naturalHeight)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
          const context = canvas.getContext('2d')
          if (!context) return resolve(null)
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', 0.75))
        } catch { resolve(null) }
      }
      image.src = source
    })
  } finally { active--; waiting.shift()?.() }
}
export function coverThumbnail(source: string, revision: string): Promise<string | null> {
  const key = `${source}\n${revision}`
  const hit = memory.get(key)
  if (hit && Date.now() - hit.time < TTL) return Promise.resolve(hit.data)
  const running = pending.get(key)
  if (running) return running
  const task = (async () => {
    const disk = await cached(key)
    const data = disk && Date.now() - disk.time < TTL ? disk.data : await resize(source)
    if (data) {
      const entry = { data, time: Date.now() }
      memory.set(key, entry)
      while (memory.size > 128) memory.delete(memory.keys().next().value!)
      void store(key, entry)
    }
    return data
  })().finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}
