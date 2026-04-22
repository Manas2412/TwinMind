import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing Groq API key' }), { status: 401 })
  }

  let body: {
    userMessage: string
    transcript: string
    chatHistory: { role: string; content: string }[]
    prompt: string
    detailedAnswerPrompt: string
    model: string
    isDetailedAnswer: boolean
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 })
  }

  const MAX_TRANSCRIPT_CHARS = 14_000
  const MAX_HISTORY_TURNS = 24

  const {
    userMessage,
    transcript,
    chatHistory,
    prompt: systemPrompt,
    detailedAnswerPrompt,
    model,
    isDetailedAnswer,
  } = body

  const transcriptTrimmed =
    typeof transcript === 'string' && transcript.length > MAX_TRANSCRIPT_CHARS
      ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
      : transcript

  const historySlice = Array.isArray(chatHistory)
    ? chatHistory.slice(-MAX_HISTORY_TURNS)
    : []

  let messages: { role: string; content: string }[]

  if (isDetailedAnswer) {
    const filledPrompt = detailedAnswerPrompt
      .replace('{{transcript}}', transcriptTrimmed)
      .replace('{{user_message}}', userMessage)
    messages = [{ role: 'user', content: filledPrompt }]
  } else {
    const filledSystem = systemPrompt
      .replace('{{transcript}}', transcriptTrimmed)
      .replace(
        '{{history}}',
        'Prior turns are in the message thread below (do not ask the user to repeat them).',
      )
    messages = [
      { role: 'system', content: filledSystem },
      ...historySlice,
      { role: 'user', content: userMessage },
    ]
  }

  const maxTokens = isDetailedAnswer ? 900 : 640

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.55,
        max_tokens: maxTokens,
        stream: true,
      }),
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      return new Response(err, { status: groqRes.status })
    }

    return new Response(groqRes.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    console.error('[chat] Groq fetch error:', err)
    return new Response(JSON.stringify({ error: 'Chat request failed', detail: String(err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
