import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Whisper's known idle/silence hallucinations. Whisper was trained on a lot of
// YouTube outros, so it loves emitting "thanks for watching" / "thank you" during
// silence. We keep the filter list focused on those specific patterns so genuine
// short utterances ("yes", "okay", "right") still pass through.
const HALLUCINATION_STRINGS = new Set([
  'e aí', 'e ai', 'obrigado', 'obrigada', 'gracias', 'de nada',
  'merci', 'danke',
  'thank you', 'thank you.', 'thank you!', 'thanks', 'thanks.', 'thanks!',
  'thank you so much', 'thank you so much.', 'thanks for watching',
  'thanks for watching!', 'thanks for watching.',
  'bye', 'bye.', 'bye!', 'goodbye', 'goodbye.',
  '...', '. . .', '♪', '[ music ]', '[music]', '[applause]', '[silence]',
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

// Substring patterns Whisper emits during silence — catches variants like
// "Thank you for watching this video!" without listing every permutation.
const HALLUCINATION_PATTERNS = [
  /\bthanks?\s+for\s+watching\b/i,
  /\bthanks?\s+for\s+listening\b/i,
  /\blike\s+and\s+subscribe\b/i,
  /\bsee\s+you\s+(in\s+the\s+)?next\s+(video|episode)\b/i,
]

function isHallucination(text: string): boolean {
  const norm = text.trim().toLowerCase()
  if (!norm) return true
  if (HALLUCINATION_STRINGS.has(norm)) return true
  if (isMostlyNonLatin(norm)) return true
  // Very short outputs that match silence-hallucination keywords
  if (norm.length <= 40 && HALLUCINATION_PATTERNS.some((re) => re.test(norm))) return true
  return false
}

async function transcribeWithGroq(
  apiKey: string,
  audioBlob: Blob,
  uploadName: string,
  model: string,
  prompt: string,
): Promise<Response> {
  const groqForm = new FormData()
  groqForm.append('file', audioBlob, uploadName)
  groqForm.append('model', model)
  groqForm.append('response_format', 'verbose_json')
  groqForm.append('language', 'en')
  if (prompt) groqForm.append('prompt', prompt)
  return fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: groqForm,
  })
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
    let groqRes = await transcribeWithGroq(apiKey, audioBlob, uploadName, model, prompt)

    // Transient 5xx / 429: one retry after a short backoff. Groq occasionally
    // returns 502/503 under load; a single retry recovers without user impact.
    if ((groqRes.status >= 500 || groqRes.status === 429) && groqRes.status !== 501) {
      await new Promise((r) => setTimeout(r, 400))
      groqRes = await transcribeWithGroq(apiKey, audioBlob, uploadName, model, prompt)
    }

    if (!groqRes.ok) {
      const err = await groqRes.text()
      console.warn('[transcribe] Groq', groqRes.status, err.slice(0, 200))
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
