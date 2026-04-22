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

// Reject lines that are entirely non-Latin (Cyrillic / Arabic / CJK / Devanagari).
// Allow occasional non-Latin chars inside otherwise English text (e.g., proper nouns).
const NON_LATIN_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\uAC00-\uD7AF]/g
function isMostlyNonLatin(text: string): boolean {
  const stripped = text.replace(/\s+/g, '')
  if (stripped.length === 0) return false
  const nonLatin = stripped.match(NON_LATIN_RE)?.length ?? 0
  return nonLatin / stripped.length > 0.4
}

// Cap on concurrent Whisper requests in flight. Higher = no head-of-line blocking
// when one request is slow; capped to avoid overloading on long sessions.
const MAX_INFLIGHT_WHISPER = 3
// Hard timeout for any single Whisper request — if Groq stalls, abort & move on.
const WHISPER_TIMEOUT_MS = 12_000
// Minimum RMS energy (0..1) to consider a chunk worth transcribing. Skips pure-silence chunks.
const VAD_RMS_THRESHOLD = 0.005

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

  // Concurrent in-flight Whisper requests; allow parallel calls instead of a hard mutex
  // so a single slow request can't block the whole pipeline.
  const inflightControllersRef = useRef<Set<AbortController>>(new Set())

  // VAD: AudioContext + AnalyserNode for RMS-based silence detection
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  // Rolling RMS for the current cycle, sampled ~10 Hz
  const cycleRmsSamplesRef = useRef<number[]>([])
  const vadTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    // 250ms timeslice so a stop() always has fresh data ready (no half-second tail loss)
    recorder.start(250)
    mediaRecorderRef.current = recorder
  }, [])

  const startVad = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      vadBufferRef.current = new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
      cycleRmsSamplesRef.current = []
      vadTickRef.current = setInterval(() => {
        const a = analyserRef.current
        const buf = vadBufferRef.current
        if (!a || !buf) return
        a.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
        const rms = Math.sqrt(sum / buf.length)
        cycleRmsSamplesRef.current.push(rms)
        // Keep last 6s worth of samples max (60 @ 100ms)
        if (cycleRmsSamplesRef.current.length > 60) cycleRmsSamplesRef.current.shift()
      }, 100)
    } catch {
      /* AudioContext unavailable — fall through; VAD becomes a no-op */
    }
  }, [])

  const stopVad = useCallback(() => {
    if (vadTickRef.current) { clearInterval(vadTickRef.current); vadTickRef.current = null }
    try { analyserRef.current?.disconnect() } catch { /* ignore */ }
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    analyserRef.current = null
    audioCtxRef.current = null
    vadBufferRef.current = null
    cycleRmsSamplesRef.current = []
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
            if (trimmed && !isMostlyNonLatin(trimmed)) {
              commitTextRef.current(trimmed)
              interimTextRef.current = ''
              upsertRollingRef.current('')
            }
          } else {
            latestInterim = text
          }
        }
        if (latestInterim && !isMostlyNonLatin(latestInterim)) {
          interimTextRef.current = latestInterim
          if (rollingDebounceRef.current) clearTimeout(rollingDebounceRef.current)
          rollingDebounceRef.current = setTimeout(() => {
            const t = interimTextRef.current.trim()
            if (t.length >= 2) upsertRollingRef.current(t)
          }, 150)
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
          try { rec.start() } catch { /* race; SR will retry on next end */ }
        }
      }

      recognitionRef.current = rec
      rec.start()
    } catch {
      /* Web Speech API unavailable in this browser — Whisper handles everything */
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
   * Each cycle:
   *  1. Snapshot the current chunks, restart recorder immediately (zero audio gap).
   *  2. VAD: skip Whisper if the cycle was effectively silent.
   *  3. Fire Whisper in parallel (no mutex). Dedupe vs SR happens in commit step.
   *  4. AbortController + timeout guarantees no zombie requests block future cycles.
   */
  const runCycle = useCallback(() => {
    const recorder = mediaRecorderRef.current
    const stream = streamRef.current
    if (!recorder || recorder.state === 'inactive' || !stream) return

    try {
      if (recorder.state === 'recording') recorder.requestData()
    } catch { /* ignore */ }

    // Snapshot VAD samples for the cycle then reset for the next one
    const rmsSamples = cycleRmsSamplesRef.current.slice()
    cycleRmsSamplesRef.current = []
    const peakRms = rmsSamples.length > 0 ? Math.max(...rmsSamples) : 0
    const hasVoice = peakRms >= VAD_RMS_THRESHOLD

    const onStop = () => {
      const rawChunks = chunksRef.current.slice()
      chunksRef.current = []

      // Restart immediately — no audio gap regardless of Whisper latency
      if (streamRef.current) startNewRecorder(streamRef.current)

      if (rawChunks.length === 0) return
      if (!apiKeyRef.current) return
      // Skip silent windows entirely — saves API calls and avoids hallucinations
      if (!hasVoice) return
      if (inflightControllersRef.current.size >= MAX_INFLIGHT_WHISPER) return

      const mime = rawChunks[0]?.type || recorder.mimeType || 'audio/webm'
      const blob = new Blob(rawChunks, { type: mime })
      if (blob.size < 200) return

      const recentText = useSessionStore
        .getState()
        .transcript.filter((c) => c.kind !== 'rolling')
        .slice(-3)
        .map((c) => c.text)
        .join(' ')
        .slice(-200)

      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm'
      const filename = `chunk.${ext}`
      const form = new FormData()
      form.append('file', blob, filename)
      form.append('filename', filename)
      form.append('model', transcriptionModelRef.current)
      if (recentText) form.append('prompt', recentText)

      const controller = new AbortController()
      inflightControllersRef.current.add(controller)
      const timeoutId = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS)

      fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'x-api-key': apiKeyRef.current },
        body: form,
        signal: controller.signal,
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
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') {
            console.error('[Whisper] fetch error:', err)
          }
        })
        .finally(() => {
          clearTimeout(timeoutId)
          inflightControllersRef.current.delete(controller)
        })
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
    const cycleMs = Math.max(2000, refreshIntervalSecs * 1000)
    intervalRef.current = setInterval(() => runCycleRef.current(), cycleMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRecording, refreshIntervalSecs])

  useEffect(() => {
    if (!isRecording) return
    rollingTickRef.current = setInterval(() => {
      const t = interimTextRef.current.trim()
      if (t.length >= 3) upsertRollingRef.current(t)
    }, 1000)
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
      // Reset any leftover in-flight controllers from a previous session
      for (const c of inflightControllersRef.current) {
        try { c.abort() } catch { /* ignore */ }
      }
      inflightControllersRef.current.clear()
      startNewRecorder(stream)
      startVad(stream)
      startRecognition()
      setRecording(true)

      // First Whisper pass at 1.5s — gives the user fast confirmation that audio is being heard.
      if (earlyWhisperTimerRef.current) clearTimeout(earlyWhisperTimerRef.current)
      earlyWhisperTimerRef.current = setTimeout(() => {
        if (useSessionStore.getState().isRecording) runCycleRef.current()
      }, 1500)
    } catch {
      alert('Could not access microphone. Please grant mic permission and try again.')
    }
  }

  const stopRecording = useCallback(() => {
    if (earlyWhisperTimerRef.current) { clearTimeout(earlyWhisperTimerRef.current); earlyWhisperTimerRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (rollingTickRef.current) { clearInterval(rollingTickRef.current); rollingTickRef.current = null }
    if (rollingDebounceRef.current) { clearTimeout(rollingDebounceRef.current); rollingDebounceRef.current = null }
    for (const c of inflightControllersRef.current) {
      try { c.abort() } catch { /* ignore */ }
    }
    inflightControllersRef.current.clear()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    stopRecognition()
    stopVad()
    upsertRollingRef.current('')
    setRecordingRef.current(false)
  }, [stopRecognition, stopVad])

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
            ? 'Live text streams from your browser; Whisper-turbo refines it every few seconds.'
            : 'Click to start. Browser SR shows words instantly; Whisper-turbo runs in parallel.'}
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
