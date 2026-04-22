'use client'

import { useState } from 'react'
import { useSettingsStore } from '@/lib/store'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'api' | 'prompts' | 'context'

export default function SettingsModal({ open, onClose }: Props) {
  const settings = useSettingsStore()
  const [tab, setTab] = useState<Tab>('api')

  if (!open) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'api', label: 'API & Model' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'context', label: 'Context & Timing' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-gray-100 dark:border-gray-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                tab === t.id
                  ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {tab === 'api' && (
            <>
              <Field
                label="Groq API Key"
                hint="Paste your key from console.groq.com. Stored in localStorage only."
                type="password"
                value={settings.apiKey}
                onChange={(v) => settings.updateSettings({ apiKey: v })}
                placeholder="gsk_…"
              />
              <Field
                label="Chat / Suggestions Model"
                hint="Groq model ID. Default: llama-3.1-8b-instant (sub-second). Try llama-3.3-70b-versatile for higher quality."
                value={settings.model}
                onChange={(v) => settings.updateSettings({ model: v })}
                placeholder="llama-3.1-8b-instant"
              />
              <Field
                label="Transcription Model"
                hint="Groq Whisper model ID. Default: whisper-large-v3-turbo (fast, accurate)."
                value={settings.transcriptionModel}
                onChange={(v) => settings.updateSettings({ transcriptionModel: v })}
                placeholder="whisper-large-v3-turbo"
              />
            </>
          )}

          {tab === 'prompts' && (
            <>
              <TextareaField
                label="Live Suggestions Prompt"
                hint="Use {{transcript}} and {{previous_suggestions}} placeholders."
                rows={8}
                value={settings.suggestionPrompt}
                onChange={(v) => settings.updateSettings({ suggestionPrompt: v })}
              />
              <TextareaField
                label="Detailed Answer Prompt (on click)"
                hint="Use {{transcript}} and {{user_message}} placeholders."
                rows={6}
                value={settings.detailedAnswerPrompt}
                onChange={(v) => settings.updateSettings({ detailedAnswerPrompt: v })}
              />
              <TextareaField
                label="Chat Prompt (user-typed messages)"
                hint="Use {{transcript}} and {{history}} placeholders."
                rows={5}
                value={settings.chatPrompt}
                onChange={(v) => settings.updateSettings({ chatPrompt: v })}
              />
              <button
                onClick={settings.resetPrompts}
                className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2"
              >
                Reset all prompts to defaults
              </button>
            </>
          )}

          {tab === 'context' && (
            <>
              <NumberField
                label="Suggestion context window (chunks)"
                hint="Number of recent transcript chunks sent to the suggestion model. 0 = all chunks."
                value={settings.suggestionContextChunks}
                onChange={(v) => settings.updateSettings({ suggestionContextChunks: v })}
                min={0}
                max={20}
              />
              <NumberField
                label="Chat context window (chunks)"
                hint="Number of recent transcript chunks sent to the chat model. 0 = full transcript."
                value={settings.chatContextChunks}
                onChange={(v) => settings.updateSettings({ chatContextChunks: v })}
                min={0}
                max={50}
              />
              <NumberField
                label="Whisper rolling-chunk interval (seconds)"
                hint="How often audio is sliced and sent to Groq Whisper-turbo. Lower = faster transcript, slightly more API calls. 3–4s is the production sweet spot."
                value={settings.refreshIntervalSecs}
                onChange={(v) => settings.updateSettings({ refreshIntervalSecs: v })}
                min={2}
                max={30}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, hint, value, onChange, placeholder, type = 'text',
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-all font-mono"
      />
    </div>
  )
}

function TextareaField({
  label, hint, value, onChange, rows = 5,
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-all font-mono resize-y"
      />
    </div>
  )
}

function NumberField({
  label, hint, value, onChange, min, max,
}: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500">{hint}</p>}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-all"
      />
    </div>
  )
}
