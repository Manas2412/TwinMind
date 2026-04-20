'use client'

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useSessionStore, useSettingsStore } from '@/lib/store'

type SRInstance = {
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: {
    resultIndex: number
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
  }) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}

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
  const runCycleRef = useRef<() => Promise<void>>(async () => {})
  const earlyWhisperTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cycleBusyRef = useRef(false)

  const interimTextRef = useRef('')
  const rollingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rollingTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const apiKeyRef = useRef(apiKey)
  const transcriptionModelRef = useRef(transcriptionModel)
  const upsertRollingRef = useRef(upsertRollingTranscript)
  const commitTextRef = useRef(commitTranscriptText)
  const setRecordingRef = useRef(setRecording)

  useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])
  useEffect(() => {
    transcriptionModelRef.current = transcriptionModel
  }, [transcriptionModel])
  useEffect(() => {
    upsertRollingRef.current = upsertRollingTranscript
  }, [upsertRollingTranscript])
  useEffect(() => {
    commitTextRef.current = commitTranscriptText
  }, [commitTranscriptText])
  useEffect(() => {
    setRecordingRef.current = setRecording
  }, [setRecording])

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
      try {
        ;(rec as unknown as { maxAlternatives?: number }).maxAlternatives = 1
      } catch {
        /* optional */
      }

      rec.onresult = (event) => {
        let latestInterim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const text = result[0]?.transcript ?? ''
          if (result.isFinal) {
            const trimmed = text.trim()
            if (trimmed) {
              commitTextRef.current(trimmed)
              interimTextRef.current = ''
              upsertRollingRef.current('')
            }
          } else {
            latestInterim = text
          }
        }
        if (latestInterim) {
          interimTextRef.current = latestInterim
          if (rollingDebounceRef.current) clearTimeout(rollingDebounceRef.current)
          rollingDebounceRef.current = setTimeout(() => {
            const t = interimTextRef.current.trim()
            if (t.length >= 3) upsertRollingRef.current(t)
          }, 320)
        } else {
          interimTextRef.current = ''
        }
      }

      rec.onerror = () => {
        /* non-fatal — Whisper still runs on a timer */
      }
      rec.onend = () => {
        if (recognitionRef.current === rec && streamRef.current) {
          try {
            rec.start()
          } catch {
            /* ignore */
          }
        }
      }

      recognitionRef.current = rec
      rec.start()
    } catch {
      /* Web Speech unavailable */
    }
  }, [])

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (rec) {
      try {
        rec.onend = null
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    interimTextRef.current = ''
    if (rollingDebounceRef.current) {
      clearTimeout(rollingDebounceRef.current)
      rollingDebounceRef.current = null
    }
  }, [])

  const runCycle = useCallback(async () => {
    if (cycleBusyRef.current) return
    const recorder = mediaRecorderRef.current
    const stream = streamRef.current
    if (!recorder || recorder.state === 'inactive' || !stream) return

    cycleBusyRef.current = true

    try {
      await new Promise<void>((resolve) => {
        const onStop = async () => {
          const rawChunks = chunksRef.current.slice()
          chunksRef.current = []

          const mime = rawChunks[0]?.type || recorder.mimeType || 'audio/webm'
          const blob =
            rawChunks.length > 0 ? new Blob(rawChunks, { type: mime }) : new Blob([], { type: mime })

          const minBytes = 650
          if (blob.size >= minBytes && apiKeyRef.current) {
            try {
              const ext = mime.includes('ogg')
                ? 'ogg'
                : mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')
                  ? 'm4a'
                  : 'webm'
              const filename = `chunk.${ext}`

              const form = new FormData()
              form.append('file', blob, filename)
              form.append('filename', filename)
              form.append('model', transcriptionModelRef.current)
              const res = await fetch('/api/transcribe', {
                method: 'POST',
                headers: { 'x-api-key': apiKeyRef.current },
                body: form,
              })
              if (res.ok) {
                const { text } = await res.json()
                const trimmed = (text ?? '').trim()
                if (trimmed) commitTextRef.current(trimmed)
              }
            } catch (err) {
              console.error('Transcription error:', err)
            }
          }

          resolve()
        }

        try {
          if (typeof recorder.requestData === 'function' && recorder.state === 'recording') {
            recorder.requestData()
          }
        } catch {
          /* ignore */
        }

        recorder.addEventListener('stop', onStop, { once: true })
        try {
          recorder.stop()
        } catch {
          resolve()
        }
      })

      if (streamRef.current) startNewRecorder(streamRef.current)
    } finally {
      cycleBusyRef.current = false
    }
  }, [startNewRecorder])

  useEffect(() => {
    runCycleRef.current = runCycle
  }, [runCycle])

  useEffect(() => {
    if (!isRecording) return
    intervalRef.current = setInterval(runCycle, refreshIntervalSecs * 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRecording, refreshIntervalSecs, runCycle])

  // While recording, keep pushing interim recognition into the transcript as a rolling row
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      streamRef.current = stream
      interimTextRef.current = ''
      startNewRecorder(stream)
      startRecognition()
      setRecording(true)
      if (earlyWhisperTimerRef.current) clearTimeout(earlyWhisperTimerRef.current)
      earlyWhisperTimerRef.current = setTimeout(() => {
        if (!useSessionStore.getState().isRecording) return
        if (!streamRef.current || !mediaRecorderRef.current) return
        void runCycleRef.current()
      }, 3500)
    } catch {
      alert('Could not access microphone. Please grant mic permission and try again.')
    }
  }

  const stopRecording = useCallback(() => {
    if (earlyWhisperTimerRef.current) {
      clearTimeout(earlyWhisperTimerRef.current)
      earlyWhisperTimerRef.current = null
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (rollingTickRef.current) {
      clearInterval(rollingTickRef.current)
      rollingTickRef.current = null
    }
    if (rollingDebounceRef.current) {
      clearTimeout(rollingDebounceRef.current)
      rollingDebounceRef.current = null
    }
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

  /** Newest lines first (matches Live Suggestions column). Store stays chronological. */
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
            ? 'Words appear as you speak; suggestions refresh shortly after new text.'
            : 'Click to start. Browser speech shows text as you talk; Groq transcribes audio periodically as a backup.'}
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
