import type { Note } from './types'

export const demoNotes: Note[] = [
  {
    path: 'journal/2026/06/2026-06-10.md',
    title: 'Daily Note',
    category: 'journal',
    tags: ['journal', 'review'],
    createdAt: '2026-06-10',
    updatedAt: '2026-06-10',
    summary: 'A starting point for today.',
    body: '# Daily Note\n\n- Capture what matters today.\n- Review open loops.\n',
    wordCount: 11,
  },
  {
    path: 'knowledge/rust/tauri-architecture.md',
    title: 'Tauri Architecture Notes',
    category: 'knowledge/rust',
    tags: ['tauri', 'rust', 'desktop'],
    createdAt: '2026-06-08',
    updatedAt: '2026-06-09',
    summary: 'Rust commands protect filesystem access while React owns interaction.',
    body: '# Tauri Architecture Notes\n\nThe frontend calls Rust commands for vault operations.\n',
    wordCount: 10,
  },
  {
    path: '00-inbox/2026-06-10-quick-thought.md',
    title: 'Quick Thought',
    category: '00-inbox',
    tags: ['inbox'],
    createdAt: '2026-06-10',
    updatedAt: '2026-06-10',
    body: '# Quick Thought\n\nTurn rough captures into durable notes.\n',
    wordCount: 8,
  },
]
