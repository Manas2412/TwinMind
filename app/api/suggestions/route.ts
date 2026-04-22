import { NextRequest, NextResponse } from 'next/server'
import type { Suggestion, SuggestionType } from '@/lib/types'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SuggestionRaw {
  type: string
  preview: string
  detail_prompt: string
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing Groq API key' }, { status: 401 })
  }

  let body: {
    recentTranscript: string
    previousSuggestions: string
    prompt: string
    model: string
    batchId: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { recentTranscript, previousSuggestions, prompt: systemPrompt, model, batchId } = body

  if (!recentTranscript?.trim()) {
    return NextResponse.json({ error: 'No transcript content' }, { status: 400 })
  }

  const filledPrompt = systemPrompt
    .replace('{{transcript}}', recentTranscript)
    .replace('{{previous_suggestions}}', previousSuggestions || 'None yet.')

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: filledPrompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
    })

    if (!groqRes.ok) {
      const err = await groqRes.text()
      return NextResponse.json({ error: err }, { status: groqRes.status })
    }

    const data = await groqRes.json()
    const raw = data.choices?.[0]?.message?.content ?? '[]'

    let parsed: SuggestionRaw[] = []
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: 'Failed to parse suggestions JSON', raw }, { status: 502 })
    }

    const validTypes = new Set<SuggestionType>([
      'question', 'answer', 'talking_point', 'fact_check', 'clarification',
    ])

    const suggestions: Suggestion[] = parsed.slice(0, 3).map((s) => ({
      id: uuidv4(),
      batchId,
      type: validTypes.has(s.type as SuggestionType) ? (s.type as SuggestionType) : 'talking_point',
      preview: s.preview ?? '',
      detailPrompt: s.detail_prompt ?? s.preview ?? '',
    }))

    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[suggestions] Groq fetch error:', err)
    return NextResponse.json(
      { error: 'Suggestions request failed', detail: String(err) },
      { status: 502 }
    )
  }
}
