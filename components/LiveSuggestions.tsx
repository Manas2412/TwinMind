'use client'

import { useEffect, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useSessionStore } from '@/lib/store'
import { useSettingsStore } from '@/lib/store'
import SuggestionCard from './SuggestionCard'
import type { Suggestion, SuggestionBatch } from '@/lib/types'

interface Props {
  onSuggestionClick: (suggestion: Suggestion) => void
}

export default function LiveSuggestions({ onSuggestionClick }: Props) {
  const { transcript, suggestionBatches, isRecording, addSuggestionBatch, isFetchingSuggestions, setFetchingSuggestions } =
    useSessionStore()
  const { apiKey, model, suggestionPrompt, suggestionContextChunks } = useSettingsStore()

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const generateSuggestions = useCallback(async () => {
    const { transcript: t, suggestionBatches: batches, isFetchingSuggestions: loading } =
      useSessionStore.getState()
    if (!apiKey || loading) return
    if (t.length === 0) return

    setFetchingSuggestions(true)

    const contextChunks =
      suggestionContextChunks === 0 ? t : t.slice(-suggestionContextChunks)
    const recentTranscript = contextChunks.map((c) => c.text).join('\n\n')

    const previousSuggestions = batches
      .slice(0, 2)
      .flatMap((b) => b.suggestions)
      .map((s) => `[${s.type}] ${s.preview}`)
      .join('\n')

    const batchId = uuidv4()

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          recentTranscript,
          previousSuggestions,
          prompt: suggestionPrompt,
          model,
          batchId,
        }),
      })

      if (res.ok) {
        const { suggestions } = await res.json()
        if (suggestions?.length) {
          const batch: SuggestionBatch = {
            id: batchId,
            suggestions,
            timestamp: Date.now(),
          }
          addSuggestionBatch(batch)
        }
      }
    } catch (err) {
      console.error('Suggestions error:', err)
    } finally {
      setFetchingSuggestions(false)
    }
  }, [apiKey, suggestionContextChunks, suggestionPrompt, model, addSuggestionBatch, setFetchingSuggestions])

  const transcriptSig = transcript
    .map((c) => `${c.id}:${c.text.length}:${c.kind ?? ''}:${c.text.slice(0, 48)}`)
    .join('|')

  useEffect(() => {
    if (!isRecording || transcript.length === 0) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void generateSuggestions()
    }, 2000)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isRecording, transcriptSig, transcript.length, generateSuggestions])

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
          2. Live Suggestions
        </span>
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
          {suggestionBatches.length} {suggestionBatches.length === 1 ? 'BATCH' : 'BATCHES'}
        </span>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
        <button
          onClick={() => void generateSuggestions()}
          disabled={isFetchingSuggestions || transcript.length === 0}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className={`w-3 h-3 ${isFetchingSuggestions ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {isFetchingSuggestions ? 'Generating…' : 'Reload suggestions'}
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {isRecording
            ? `Auto ~2s after new transcript text${
                suggestionBatches[0] ? ` · latest ${fmtTime(suggestionBatches[0].timestamp)}` : ''
              }`
            : 'Record to enable auto-updates'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {suggestionBatches.length === 0 ? (
          <div className="text-center mt-8 space-y-2">
            <p className="text-gray-300 dark:text-gray-600 text-xs">
              {transcript.length === 0
                ? 'Start recording to generate suggestions…'
                : isRecording
                  ? 'Suggestions appear shortly after transcript updates while you speak.'
                  : 'Click "Reload suggestions" or start recording again for auto-updates.'}
            </p>
          </div>
        ) : (
          suggestionBatches.map((batch, batchIdx) => (
            <div key={batch.id} className="space-y-2">
              <div className="text-center text-[10px] text-gray-400 dark:text-gray-500 py-0.5">
                — BATCH {suggestionBatches.length - batchIdx} · {fmtTime(batch.timestamp)} —
              </div>
              {batch.suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  faded={batchIdx > 0}
                  onClick={onSuggestionClick}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
