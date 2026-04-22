import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Whisper's known idle/silence hallucinations. Kept to obvious filler so we never
// drop short legitimate utterances ("yes", "okay", "you know" etc).
const HALLUCINATION_STRINGS = new Set([
  'e aí', 'e ai', 'obrigado', 'obrigada', 'gracias', 'de nada',
  'merci', 'danke',
  '...', '. . .', '♪', '[ music ]', '[music]', '[applause]',
  'subtitles by the amara.org community',
  'субтитры создал dimatorzok',
  'субтитры добавил dimatorzok',
])

// Cyrillic / Arabic / Devanagari / CJK / Hangul. Used to gate output that is
// PREDOMINANTLY non-Latin — small spillover (proper nouns) is allowed.
const NON_LATIN_RE = /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF\uAC00-\uD7AF]/g

function isMostlyNonLatin(text: string): boolean {
  const stripped = text.replace(/\s+/g, '')
  if (stripped.length === 0) return true
  const nonLatin = stripped.match(NON_LATIN_RE)?.length ?? 0
  return nonLatin / stripped.length > 0.4
}

function isHallucination(text: string): boolean {
  const norm = text.trim().toLowerCase()
  if (!norm) return true
  if (HALLUCINATION_STRINGS.has(norm)) return true
  if (isMostlyNonLatin(norm)) return true
  return false
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing Groq API key' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const audioBlob = formData.get('file')
  const model = (formData.get('model') as string) || 'whisper-large-v3'
  const clientName = (formData.get('filename') as string | null)?.trim()
  const prompt = (formData.get('prompt') as string | null)?.trim() || ''

  if (!audioBlob || !(audioBlob instanceof Blob)) {
    return NextResponse.json({ error: 'Missing audio file' }, { status: 400 })
  }

  const mime = audioBlob.type || ''
  const extFromMime = mime.includes('ogg')
    ? 'ogg'
    : mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')
      ? 'm4a'
      : mime.includes('webm')
        ? 'webm'
        : 'webm'
  const uploadName =
    clientName && /\.(webm|ogg|m4a|mp4|wav|mpeg|mp3)$/i.test(clientName)
      ? clientName
      : `audio.${extFromMime}`

  try {
    const groqForm = new FormData()
    groqForm.append('file', audioBlob, uploadName)
    groqForm.append('model', model)
    groqForm.append('response_format', 'verbose_json')
    groqForm.append('language', 'en')   // ← lock to English; prevents Russian/Urdu/etc hallucinations
    if (prompt) groqForm.append('prompt', prompt)

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      return NextResponse.json({ error: err }, { status: groqRes.status })
    }

    const data = await groqRes.json()
    const text: string = data.text ?? ''

    // Confidence filtering via verbose_json segments
    const segments: { no_speech_prob?: number; avg_logprob?: number }[] =
      Array.isArray(data.segments) ? data.segments : []

    // Confidence gating: only drop output that's clearly silence or gibberish.
    // Loose thresholds — Whisper-turbo is conservative on short clips so a tight
    // gate (e.g. avg_logprob < -1.0) silently swallows legitimate speech.
    if (segments.length > 0) {
      const avgNoSpeech =
        segments.reduce((sum, s) => sum + (s.no_speech_prob ?? 0), 0) / segments.length
      if (avgNoSpeech > 0.85) return NextResponse.json({ text: '' })

      const avgLogProb =
        segments.reduce((sum, s) => sum + (s.avg_logprob ?? 0), 0) / segments.length
      if (avgLogProb < -1.5) return NextResponse.json({ text: '' })
    }

    if (isHallucination(text)) return NextResponse.json({ text: '' })

    return NextResponse.json({ text: text.trim() })
  } catch (err) {
    console.error('[transcribe] Groq fetch error:', err)
    return NextResponse.json(
      { error: 'Transcription request failed', detail: String(err) },
      { status: 502 }
    )
  }
}
