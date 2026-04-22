'use client'

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useSessionStore, useSettingsStore } from '@/lib/store'

type SRInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: {
    resultIndex: number
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
  }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

// Reject SR output containing non-Latin scripts (Cyrillic, Arabic, CJK, etc.)
const NON_LATIN_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\uAC00-\uD7AF]/

export default function MicTranscript() {
  const { isRecording, transcript, setRecording, upsertRollingTranscript, commitTranscriptText } =
    useSessionStore()
  const { apiKey, transcriptionModel, refreshIntervalSecs } = useSettingsStore()

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SRInstance | null>(null)
  const runCycleRef = useRef<() => void>(() => {})
  const earlyWhisperTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // How many SR finals were committed since the last Whisper cycle start.
  // If > 0, SR already transcribed this window — skip Whisper to avoid garbage.
  const srFinalsThisCycleRef = useRef(0)
  // Prevents concurrent Whisper HTTP requests; recorder always restarts immediately.
  const whisperInFlightRef = useRef(false)

  const interimTextRef = useRef('')
  const rollingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rollingTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const apiKeyRef = useRef(apiKey)
  const transcriptionModelRef = useRef(transcriptionModel)
  const upsertRollingRef = useRef(upsertRollingTranscript)
  const commitTextRef = useRef(commitTranscriptText)
  const setRecordingRef = useRef(setRecording)

  useEffect(() => { apiKeyRef.current = apiKey }, [apiKey])
  useEffect(() => { transcriptionModelRef.current = transcriptionModel }, [transcriptionModel])
  useEffect(() => { upsertRollingRef.current = upsertRollingTranscript }, [upsertRollingTranscript])
  useEffect(() => { commitTextRef.current = commitTranscriptText }, [commitTranscriptText])
  useEffect(() => { setRecordingRef.current = setRecording }, [setRecording])

  const startNewRecorder = useCallback((stream: MediaStream) => {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
      .find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.start(500)
    mediaRecorderRef.current = recorder
  }, [])

  const startRecognition = useCallback(() => {
    if (typeof window === 'undefined') return
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SRInstance }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SRInstance }).webkitSpeechRecognition
    if (!SR) return

    try {
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'

      rec.onresult = (event) => {
        let latestInterim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const text = result[0]?.transcript ?? ''
          if (result.isFinal) {
            const trimmed = text.trim()
            // Drop non-Latin output — SR occasionally picks up background audio
            if (trimmed && !NON_LATIN_RE.test(trimmed)) {
              commitTextRef.current(trimmed)
              srFinalsThisCycleRef.current += 1
              interimTextRef.current = ''
              upsertRollingRef.current('')
            }
          } else {
            latestInterim = text
          }
        }
        if (latestInterim && !NON_LATIN_RE.test(latestInterim)) {
          interimTextRef.current = latestInterim
          if (rollingDebounceRef.current) clearTimeout(rollingDebounceRef.current)
          rollingDebounceRef.current = setTimeout(() => {
            const t = interimTextRef.current.trim()
            if (t.length >= 3) upsertRollingRef.current(t)
          }, 300)
        } else if (!latestInterim) {
          interimTextRef.current = ''
        }
      }

      rec.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[SR] error:', e.error)
        }
      }

      rec.onend = () => {
        if (recognitionRef.current === rec && streamRef.current) {
          try { rec.start() } catch { /* ignore race */ }
        }
      }

      recognitionRef.current = rec
      rec.start()
    } catch {
      /* Web Speech unavailable — Whisper handles everything */
    }
  }, [])

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      try { rec.onend = null; rec.stop() } catch { /* ignore */ }
    }
    interimTextRef.current = ''
    if (rollingDebounceRef.current) {
      clearTimeout(rollingDebounceRef.current)
      rollingDebounceRef.current = null
    }
  }, [])

  /**
   * Core cycle:
   * 1. Snapshot SR finals count then reset it.
   * 2. Stop recorder, IMMEDIATELY restart it (zero audio gap).
   * 3. If SR had ≥1 finals this window → SR already transcribed speech, skip Whisper.
   * 4. Otherwise fire Whisper asynchronously (fire-and-forget).
   */
  const runCycle = useCallback(() => {
    const recorder = mediaRecorderRef.current
    const stream = streamRef.current
    if (!recorder || recorder.state === 'inactive' || !stream) return

    // Snapshot and reset before the stop so new SR finals go into the next cycle
    const hadSrFinals = srFinalsThisCycleRef.current > 0
    srFinalsThisCycleRef.current = 0

    try {
      if (recorder.state === 'recording') recorder.requestData()
    } catch { /* ignore */ }

    const onStop = () => {
      const rawChunks = chunksRef.current.slice()
      chunksRef.current = []

      // Restart immediately — no audio gap regardless of Whisper latency
      if (streamRef.current) startNewRecorder(streamRef.current)

      // SR already captured speech this window — Whisper would only add noise/duplicates
      if (hadSrFinals) return

      if (rawChunks.length === 0 || !apiKeyRef.current || whisperInFlightRef.current) return

      const mime = rawChunks[0]?.type || recorder.mimeType || 'audio/webm'
      const blob = new Blob(rawChunks, { type: mime })
      if (blob.size < 500) return

      whisperInFlightRef.current = true

      const recentText = useSessionStore
        .getState()
        .transcript.filter((c) => c.kind !== 'rolling')
        .slice(-3)
        .map((c) => c.text)
        .join(' ')
        .slice(-150)

      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm'
      const filename = `chunk.${ext}`
      const form = new FormData()
      form.append('file', blob, filename)
      form.append('filename', filename)
      form.append('model', transcriptionModelRef.current)
      if (recentText) form.append('prompt', recentText)

      fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'x-api-key': apiKeyRef.current },
        body: form,
      })
        .then(async (res) => {
          if (res.ok) {
            const { text } = await res.json()
            const trimmed = (text ?? '').trim()
            if (trimmed) commitTextRef.current(trimmed)
          } else {
            console.warn('[Whisper] non-ok:', res.status)
          }
        })
        .catch((err) => console.error('[Whisper] fetch error:', err))
        .finally(() => { whisperInFlightRef.current = false })
    }

    recorder.addEventListener('stop', onStop, { once: true })
    try {
      recorder.stop()
    } catch {
      if (streamRef.current) startNewRecorder(streamRef.current)
    }
  }, [startNewRecorder])

  useEffect(() => { runCycleRef.current = runCycle }, [runCycle])

  useEffect(() => {
    if (!isRecording) return
    intervalRef.current = setInterval(() => runCycleRef.current(), refreshIntervalSecs * 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRecording, refreshIntervalSecs])

  useEffect(() => {
    if (!isRecording) return
    rollingTickRef.current = setInterval(() => {
      const t = interimTextRef.current.trim()
      if (t.length >= 5) upsertRollingRef.current(t)
    }, 2000)
    return () => {
      if (rollingTickRef.current) clearInterval(rollingTickRef.current)
      rollingTickRef.current = null
    }
  }, [isRecording])

  const startRecording = async () => {
    if (!apiKey) {
      alert('Please set your Groq API key in Settings first.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      streamRef.current = stream
      interimTextRef.current = ''
      srFinalsThisCycleRef.current = 0
      whisperInFlightRef.current = false
      startNewRecorder(stream)
      startRecognition()
      setRecording(true)

      if (earlyWhisperTimerRef.current) clearTimeout(earlyWhisperTimerRef.current)
      earlyWhisperTimerRef.current = setTimeout(() => {
        if (useSessionStore.getState().isRecording) runCycleRef.current()
      }, 5000)
    } catch {
      alert('Could not access microphone. Please grant mic permission and try again.')
    }
  }

  const stopRecording = useCallback(() => {
    if (earlyWhisperTimerRef.current) { clearTimeout(earlyWhisperTimerRef.current); earlyWhisperTimerRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (rollingTickRef.current) { clearInterval(rollingTickRef.current); rollingTickRef.current = null }
    if (rollingDebounceRef.current) { clearTimeout(rollingDebounceRef.current); rollingDebounceRef.current = null }
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    stopRecognition()
    upsertRollingRef.current('')
    setRecordingRef.current(false)
  }, [stopRecognition])

  useEffect(() => () => stopRecording(), [stopRecording])

  const transcriptNewestFirst = useMemo(() => [...transcript].reverse(), [transcript])
  const transcriptLineIdsKey = transcript.map((c) => c.id).join('|')
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [transcriptLineIdsKey])

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
          1. Mic &amp; Transcript
        </span>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isRecording
              ? 'bg-red-100 text-red-600 animate-pulse'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          {isRecording ? 'RECORDING' : 'IDLE'}
        </span>
      </div>

      <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-3">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`w-14 h-14 rounded-full flex items-center justify-center shadow-md transition-all ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600 ring-4 ring-red-200'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
          aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        >
          {isRecording ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm6 11a1 1 0 0 1 2 0 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0z" />
            </svg>
          )}
        </button>

        <p className="text-xs text-gray-400 dark:text-gray-500 text-center leading-4">
          {isRecording
            ? 'Words appear as you speak; Whisper fills in gaps when browser SR is silent.'
            : 'Click to start. Browser speech shows text in real time; Whisper transcribes in the background.'}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 text-sm">
        {transcript.length === 0 ? (
          <p className="text-gray-300 dark:text-gray-600 text-xs mt-4 text-center">
            Transcript will appear here as you speak…
          </p>
        ) : (
          transcriptNewestFirst.map((chunk) => (
            <div key={chunk.id} className="flex gap-2">
              <span
                className={`text-xs mt-0.5 shrink-0 font-mono ${
                  chunk.kind === 'rolling' ? 'text-blue-400' : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {chunk.kind === 'rolling' ? '⋯' : fmtTime(chunk.timestamp)}
              </span>
              <p
                className={`leading-relaxed ${
                  chunk.kind === 'rolling'
                    ? 'text-gray-600 dark:text-gray-300 italic'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {chunk.text}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
