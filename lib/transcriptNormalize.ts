/**
 * Clean up browser / ASR output: trim, collapse stutter-style repeats, merge extensions.
 */

const MERGE_WINDOW_MS = 11_000

/** Collapse immediate back-to-back repetition of the same word sequence (e.g. "do you know X do you know X"). */
export function collapseImmediateRepeatedPhrases(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  // Avoid touching short lines — can garble valid short questions
  if (words.length < 14) return text.trim()

  const out: string[] = []
  let i = 0
  while (i < words.length) {
    let advanced = false
    const maxPhrase = Math.min(36, Math.floor((words.length - i) / 2))
    for (let len = maxPhrase; len >= 4; len--) {
      if (i + 2 * len > words.length) continue
      const a = words.slice(i, i + len).join(' ').toLowerCase()
      const b = words.slice(i + len, i + 2 * len).join(' ').toLowerCase()
      if (a === b) {
        out.push(...words.slice(i, i + len))
        i += 2 * len
        advanced = true
        break
      }
    }
    if (!advanced) {
      out.push(words[i]!)
      i++
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

export function normalizeSpeechChunk(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  t = collapseImmediateRepeatedPhrases(t)
  return t
}

export type MergeDecision =
  | { kind: 'skip' }
  | { kind: 'append'; text: string }
  | { kind: 'replace_last'; text: string }

/**
 * Decide whether incoming text should extend/replace the previous line instead of a new row
 * (reduces fragmented SR finals and duplicate Whisper lines).
 */
export function mergeWithLastLine(lastLine: string, incoming: string): MergeDecision {
  const a = lastLine.trim()
  const b = incoming.trim()
  if (!b) return { kind: 'skip' }
  if (!a) return { kind: 'append', text: b }

  const al = a.toLowerCase()
  const bl = b.toLowerCase()

  if (al === bl) return { kind: 'skip' }

  // Two distinct questions — do not merge into one line
  const qA = (a.match(/\?/g) || []).length
  const qB = (b.match(/\?/g) || []).length
  if (qA >= 1 && qB >= 1 && !bl.startsWith(al) && !al.startsWith(bl)) {
    return { kind: 'append', text: b }
  }

  // Incoming is a longer continuation of the same utterance
  if (bl.startsWith(al) && b.length > a.length) {
    return { kind: 'replace_last', text: b }
  }
  if (al.startsWith(bl) && a.length >= b.length) {
    return { kind: 'skip' }
  }

  // Near-duplicate containment (SR + Whisper) — require substantial overlap, not loose word sharing
  if (a.length >= 20 && bl.includes(al)) {
    return { kind: 'replace_last', text: b.length > a.length ? b : a }
  }
  if (b.length >= 20 && al.includes(bl)) {
    return { kind: 'replace_last', text: a.length > b.length ? a : b }
  }

  // High word-overlap only: avoid merging unrelated lines
  const wa = new Set(al.split(/\s+/).filter((w) => w.length > 2))
  const wb = new Set(bl.split(/\s+/).filter((w) => w.length > 2))
  if (wa.size >= 5 && wb.size >= 5) {
    let inter = 0
    for (const w of wa) if (wb.has(w)) inter++
    const union = wa.size + wb.size - inter
    const jacc = union > 0 ? inter / union : 0
    if (jacc > 0.88) {
      return { kind: 'replace_last', text: b.length >= a.length ? b : a }
    }
  }

  return { kind: 'append', text: b }
}

export { MERGE_WINDOW_MS }
