import { useEffect, useRef, useState, type ReactNode } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import type { Note } from '../../shared/types'
import { noteCoverSource } from '../../shared/noteCover'
import { toMarkdownImagePreviewSrc } from '../../shared/markdownImages'
import { coverThumbnail } from '../../shared/coverThumbnailCache'

export function NoteCoverPreview({ note, vaultRoot, fallback, showExcerpt = false }: {
  note: Note; vaultRoot: string; fallback: ReactNode; showExcerpt?: boolean
}) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const source = noteCoverSource(note)
  const key = `${vaultRoot}:${note.path}:${source}:${note.sourceRevision ?? note.updatedAt}`
  const [loaded, setLoaded] = useState<{ key: string; data: string } | null>(null)
  useEffect(() => {
    if (!source || !root.current) return
    let active = true, started = false
    function load() {
      if (started) return
      started = true
      const url = toMarkdownImagePreviewSrc(vaultRoot, note.path, source!, convertFileSrc)
      void coverThumbnail(url, note.sourceRevision ?? note.updatedAt).then((data) => {
        if (active && data) setLoaded({ key, data })
      }).catch(() => {})
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(); observer?.disconnect() }
    }, { rootMargin: '100px' })
    if (observer) observer.observe(root.current)
    else load()
    return () => { active = false; observer?.disconnect() }
  }, [key, source, vaultRoot, note.path, note.sourceRevision, note.updatedAt])
  const data = loaded?.key === key ? loaded.data : null
  return <div ref={root} className="note-cover-preview">
    {data ? <><img className="note-cover-image" src={data} alt={t('editor.coverPreview')} decoding="async" />{showExcerpt && fallback}</> : fallback}
  </div>
}
