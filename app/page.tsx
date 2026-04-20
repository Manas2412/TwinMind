'use client'

import { useState, useCallback } from 'react'
import MicTranscript from '@/components/MicTranscript'
import LiveSuggestions from '@/components/LiveSuggestions'
import ChatPanel from '@/components/ChatPanel'
import SettingsModal from '@/components/SettingsModal'
import ExportButton from '@/components/ExportButton'
import { useSettingsStore } from '@/lib/store'
import { useDarkMode } from '@/lib/useDarkMode'
import type { Suggestion } from '@/lib/types'

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingSuggestion, setPendingSuggestion] = useState<Suggestion | null>(null)
  const { apiKey } = useSettingsStore()
  const { dark, toggle: toggleDark } = useDarkMode()

  const handleSuggestionClick = useCallback((suggestion: Suggestion) => {
    setPendingSuggestion(suggestion)
  }, [])

  const handleSuggestionConsumed = useCallback(() => {
    setPendingSuggestion(null)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm tracking-tight text-gray-900 dark:text-white">TwinMind</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">— Live Suggestions Web App</span>
        </div>
        <div className="flex items-center gap-4">
          <ExportButton />
          <button
            onClick={toggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              !apiKey
                ? 'border-amber-300 bg-amber-50 text-amber-700 animate-pulse'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {!apiKey ? 'Set API Key' : 'Settings'}
          </button>
        </div>
      </header>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden divide-x divide-gray-200 dark:divide-gray-700">
        {/* Left: Mic + Transcript */}
        <div className="w-1/3 flex flex-col overflow-hidden">
          <MicTranscript />
        </div>

        {/* Middle: Live Suggestions */}
        <div className="w-1/3 flex flex-col overflow-hidden">
          <LiveSuggestions onSuggestionClick={handleSuggestionClick} />
        </div>

        {/* Right: Chat */}
        <div className="w-1/3 flex flex-col overflow-hidden">
          <ChatPanel
            pendingSuggestion={pendingSuggestion}
            onSuggestionConsumed={handleSuggestionConsumed}
          />
        </div>
      </div>

      {/* Settings modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
