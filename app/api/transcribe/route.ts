import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

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

  // Forward to Groq Whisper
  const groqForm = new FormData()
  groqForm.append('file', audioBlob, uploadName)
  groqForm.append('model', model)
  groqForm.append('response_format', 'json')

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
  return NextResponse.json({ text: data.text ?? '' })
}
