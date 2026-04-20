'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import ReactMarkdown from 'react-markdown'
import { useSessionStore } from '@/lib/store'
import { useSettingsStore } from '@/lib/store'
import type { Suggestion, ChatMessage } from '@/lib/types'

interface Props {
  pendingSuggestion: Suggestion | null
  onSuggestionConsumed: () => void
}

export default function ChatPanel({ pendingSuggestion, onSuggestionConsumed }: Props) {
  const [input, setInput] = useState('')
  const { transcript, chatMessages, addChatMessage, updateChatMessage, isFetchingChat, setFetchingChat } =
    useSessionStore()
  const { apiKey, model, chatPrompt, detailedAnswerPrompt, chatContextChunks } = useSettingsStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const getTranscriptText = useCallback(() => {
    const chunks = chatContextChunks === 0 ? transcript : transcript.slice(-chatContextChunks)
    return chunks.map((c) => c.text).join('\n\n') || '(No transcript yet)'
  }, [transcript, chatContextChunks])

  const streamChat = useCallback(
    async (userText: string, isDetailedAnswer: boolean) => {
      if (!apiKey || isFetchingChat) return

      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        content: userText,
        timestamp: Date.now(),
      }
      addChatMessage(userMsg)
      setFetchingChat(true)

      const assistantId = uuidv4()
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      }
      addChatMessage(assistantMsg)

      // useSessionStore.getState() so history is correct in the same tick (hook closure would be stale)
      const historyForApi = useSessionStore
        .getState()
        .chatMessages.filter((m) => m.id !== userMsg.id && m.id !== assistantId && !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content }))

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({
            userMessage: userText,
            transcript: getTranscriptText(),
            chatHistory: historyForApi,
            prompt: chatPrompt,
            detailedAnswerPrompt,
            model,
            isDetailedAnswer,
          }),
        })

        if (!res.ok || !res.body) {
          throw new Error(await res.text())
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''
        let sseCarry = ''

        while (true) {
          const { done, value } = await reader.read()
          sseCarry += decoder.decode(value ?? new Uint8Array(), { stream: !done })
          const lines = sseCarry.split('\n')
          sseCarry = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content ?? ''
              if (delta) {
                accumulated += delta
                updateChatMessage(assistantId, { content: accumulated })
              }
            } catch {
              // ignore malformed SSE fragments
            }
          }
          if (done) break
        }

        updateChatMessage(assistantId, { isStreaming: false })
      } catch (err) {
        console.error('Chat error:', err)
        updateChatMessage(assistantId, {
          content: 'Sorry, something went wrong. Please check your API key and try again.',
          isStreaming: false,
        })
      } finally {
        setFetchingChat(false)
      }
    },
    [
      apiKey,
      isFetchingChat,
      chatPrompt,
      detailedAnswerPrompt,
      model,
      getTranscriptText,
      addChatMessage,
      updateChatMessage,
      setFetchingChat,
    ]
  )

  // Handle incoming suggestion click
  useEffect(() => {
    if (!pendingSuggestion) return
    const label = `[${pendingSuggestion.type.replace('_', ' ').toUpperCase()}] ${pendingSuggestion.preview}`
    streamChat(label, true)
    onSuggestionConsumed()
  }, [pendingSuggestion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chatMessages])

  const handleSubmit = () => {
    const text = input.trim()
    if (!text || isFetchingChat) return
    setInput('')
    streamChat(text, false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
          3. Chat (Detailed Answers)
        </span>
        <span className="text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 px-2 py-0.5 rounded-full">
          SESSION-ONLY
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {chatMessages.length === 0 ? (
          <p className="text-gray-300 dark:text-gray-600 text-xs text-center mt-8">
            Click a suggestion or type a question to get a detailed answer…
          </p>
        ) : (
          chatMessages.map((msg) => (
            <div key={msg.id} className={`flex flex-col gap-0.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 px-1">
                {msg.role === 'user' ? 'YOU' : 'ASSISTANT'} · {fmtTime(msg.timestamp)}
              </span>
              {msg.role === 'user' ? (
                <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 max-w-[85%] text-sm leading-relaxed">
                  {msg.content}
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm px-3.5 py-2.5 max-w-[95%] text-sm leading-relaxed prose prose-sm prose-gray dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content || (msg.isStreaming ? '▋' : '')}</ReactMarkdown>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-3">
        <div className="flex gap-2 items-end bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none max-h-32"
            style={{ lineHeight: '1.5' }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isFetchingChat}
            className="shrink-0 bg-blue-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
