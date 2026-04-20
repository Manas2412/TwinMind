export type SuggestionType =
  | 'question'
  | 'answer'
  | 'talking_point'
  | 'fact_check'
  | 'clarification'

export interface TranscriptChunk {
  id: string
  text: string
  timestamp: number
  /** In-progress line while the browser is still recognizing speech */
  kind?: 'rolling'
}

export interface Suggestion {
  id: string
  type: SuggestionType
  preview: string
  detailPrompt: string
  batchId: string
}

export interface SuggestionBatch {
  id: string
  suggestions: Suggestion[]
  timestamp: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
}

export interface Settings {
  apiKey: string
  model: string
  transcriptionModel: string
  suggestionPrompt: string
  detailedAnswerPrompt: string
  chatPrompt: string
  suggestionContextChunks: number
  chatContextChunks: number
  refreshIntervalSecs: number
}
