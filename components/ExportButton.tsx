'use client'

import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/lib/store'

export default function ExportButton() {
  const { transcript, suggestionBatches, chatMessages } = useSessionStore()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = () => {
    const fmt = (ts: number) => new Date(ts).toISOString()

    const payload = {
      exported_at: new Date().toISOString(),
      transcript: transcript.map((c) => ({
        timestamp: fmt(c.timestamp),
        text: c.text,
      })),
      suggestion_batches: suggestionBatches.map((b) => ({
        batch_id: b.id,
        timestamp: fmt(b.timestamp),
        suggestions: b.suggestions.map((s) => ({
          type: s.type,
          preview: s.preview,
        })),
      })),
      chat_history: chatMessages.map((m) => ({
        timestamp: fmt(m.timestamp),
        role: m.role,
        content: m.content,
      })),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `twinmind-session-${Date.now()}.json`)
    setOpen(false)
  }

  const exportText = () => {
    const fmtTime = (ts: number) =>
      new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

    const labelFor = (type: string) => type.replace('_', ' ').toUpperCase()

    const lines: string[] = []
    lines.push('TwinMind Session Export')
    lines.push(`Exported: ${new Date().toISOString()}`)
    lines.push('')

    lines.push('=== TRANSCRIPT ===')
    if (transcript.length === 0) {
      lines.push('(empty)')
    } else {
      for (const c of transcript) {
        lines.push(`[${fmtTime(c.timestamp)}] ${c.text}`)
      }
    }
    lines.push('')

    lines.push('=== SUGGESTION BATCHES ===')
    lines.push('')
    if (suggestionBatches.length === 0) {
      lines.push('(empty)')
    } else {
      // Render in chronological order: oldest BATCH 1 first
      const ordered = [...suggestionBatches].reverse()
      ordered.forEach((b, i) => {
        lines.push(`BATCH ${i + 1} — ${fmtTime(b.timestamp)}`)
        for (const s of b.suggestions) {
          lines.push(`  [${labelFor(s.type)}] ${s.preview}`)
        }
        lines.push('')
      })
    }

    lines.push('=== CHAT HISTORY ===')
    if (chatMessages.length === 0) {
      lines.push('(empty)')
    } else {
      for (const m of chatMessages) {
        lines.push(`[${fmtTime(m.timestamp)}] ${m.role === 'user' ? 'YOU' : 'ASSISTANT'}: ${m.content}`)
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    downloadBlob(blob, `twinmind-session-${Date.now()}.txt`)
    setOpen(false)
  }

  const isEmpty = transcript.length === 0 && suggestionBatches.length === 0 && chatMessages.length === 0

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isEmpty}
        title="Export session"
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Export session
      </button>

      {open && !isEmpty && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
          <button
            onClick={exportJson}
            className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Export as JSON
          </button>
          <button
            onClick={exportText}
            className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Export as Text
          </button>
        </div>
      )}
    </div>
  )
}
