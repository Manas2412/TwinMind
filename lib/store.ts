'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TranscriptChunk, SuggestionBatch, ChatMessage, Settings } from './types'
import {
  MERGE_WINDOW_MS,
  mergeWithLastLine,
  normalizeSpeechChunk,
} from './transcriptNormalize'
import {
  DEFAULT_SUGGESTION_PROMPT,
  DEFAULT_DETAILED_ANSWER_PROMPT,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_SETTINGS,
} from './prompts'

interface SettingsState extends Settings {
  updateSettings: (patch: Partial<Settings>) => void
  resetPrompts: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      model: DEFAULT_SETTINGS.model,
      transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
      suggestionPrompt: DEFAULT_SUGGESTION_PROMPT,
      detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
      chatPrompt: DEFAULT_CHAT_PROMPT,
      suggestionContextChunks: DEFAULT_SETTINGS.suggestionContextChunks,
      chatContextChunks: DEFAULT_SETTINGS.chatContextChunks,
      refreshIntervalSecs: DEFAULT_SETTINGS.refreshIntervalSecs,
      updateSettings: (patch) => set((s) => ({ ...s, ...patch })),
      resetPrompts: () =>
        set({
          suggestionPrompt: DEFAULT_SUGGESTION_PROMPT,
          detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
          chatPrompt: DEFAULT_CHAT_PROMPT,
        }),
    }),
    {
      name: 'twinmind-settings',
      version: 3,
      migrate: (persisted: unknown, fromVersion: number) => {
        const s = persisted as Partial<SettingsState>
        // v0→v1: initial
        // v1→v2: fix incorrect model default
        if (fromVersion < 2) {
          const staleModels = new Set([
            'meta-llama/llama-4-maverick-17b-128e-instruct',
          ])
          if (!s.model || staleModels.has(s.model)) {
            s.model = DEFAULT_SETTINGS.model
          }
        }
        // v2→v3: shorten suggestion cycle default
        if (fromVersion < 3) {
          if (s.refreshIntervalSecs === undefined || s.refreshIntervalSecs > 20) {
            s.refreshIntervalSecs = DEFAULT_SETTINGS.refreshIntervalSecs
          }
        }
        return s
      },
    }
  )
)

interface SessionState {
  isRecording: boolean
  transcript: TranscriptChunk[]
  suggestionBatches: SuggestionBatch[]
  chatMessages: ChatMessage[]
  isFetchingSuggestions: boolean
  isFetchingChat: boolean
  setRecording: (v: boolean) => void
  addTranscriptChunk: (chunk: TranscriptChunk) => void
  /** Replace rolling tail or append one; pass "" to drop only the rolling line */
  upsertRollingTranscript: (text: string) => void
  /** Append a finalized chunk and clear any rolling preview rows */
  addCommittedTranscriptChunk: (chunk: TranscriptChunk) => void
  /** Normalize, de-duplicate, and merge with recent line when appropriate (mic path) */
  commitTranscriptText: (raw: string) => void
  addSuggestionBatch: (batch: SuggestionBatch) => void
  addChatMessage: (msg: ChatMessage) => void
  updateChatMessage: (id: string, patch: Partial<ChatMessage>) => void
  setFetchingSuggestions: (v: boolean) => void
  setFetchingChat: (v: boolean) => void
  resetSession: () => void
}

export const useSessionStore = create<SessionState>()((set) => ({
  isRecording: false,
  transcript: [],
  suggestionBatches: [],
  chatMessages: [],
  isFetchingSuggestions: false,
  isFetchingChat: false,

  setRecording: (v) => set({ isRecording: v }),
  addTranscriptChunk: (chunk) =>
    set((s) => ({ transcript: [...s.transcript, chunk] })),
  upsertRollingTranscript: (text) =>
    set((s) => {
      const t = text.trim()
      const withoutRolling = s.transcript.filter((c) => c.kind !== 'rolling')
      if (!t) {
        return { transcript: withoutRolling }
      }
      const tr = s.transcript
      const last = tr[tr.length - 1]
      if (last?.kind === 'rolling') {
        if (last.text === t) return s
        return {
          transcript: [...tr.slice(0, -1), { ...last, text: t, timestamp: Date.now() }],
        }
      }
      return {
        transcript: [
          ...tr,
          {
            id: crypto.randomUUID(),
            text: t,
            timestamp: Date.now(),
            kind: 'rolling' as const,
          },
        ],
      }
    }),
  addCommittedTranscriptChunk: (chunk) =>
    set((s) => ({
      transcript: [
        ...s.transcript.filter((c) => c.kind !== 'rolling'),
        { id: chunk.id, text: chunk.text, timestamp: chunk.timestamp },
      ],
    })),
  commitTranscriptText: (raw) =>
    set((s) => {
      const normalized = normalizeSpeechChunk(raw)
      if (!normalized) return s

      const committed = s.transcript.filter((c) => c.kind !== 'rolling')
      const rolling = s.transcript.filter((c) => c.kind === 'rolling')
      const last = committed[committed.length - 1]
      const now = Date.now()

      if (last && now - last.timestamp <= MERGE_WINDOW_MS) {
        const decision = mergeWithLastLine(last.text, normalized)
        if (decision.kind === 'skip') return s
        if (decision.kind === 'replace_last') {
          return {
            transcript: [
              ...committed.slice(0, -1),
              { ...last, text: decision.text, timestamp: now },
              ...rolling,
            ],
          }
        }
        if (decision.kind === 'append') {
          return {
            transcript: [
              ...committed,
              { id: crypto.randomUUID(), text: decision.text, timestamp: now },
              ...rolling,
            ],
          }
        }
      }

      return {
        transcript: [
          ...committed,
          { id: crypto.randomUUID(), text: normalized, timestamp: now },
          ...rolling,
        ],
      }
    }),
  addSuggestionBatch: (batch) =>
    set((s) => ({ suggestionBatches: [batch, ...s.suggestionBatches] })),
  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  updateChatMessage: (id, patch) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  setFetchingSuggestions: (v) => set({ isFetchingSuggestions: v }),
  setFetchingChat: (v) => set({ isFetchingChat: v }),
  resetSession: () =>
    set({ transcript: [], suggestionBatches: [], chatMessages: [] }),
}))
