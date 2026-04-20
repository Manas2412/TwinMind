'use client'

import type { Suggestion, SuggestionType } from '@/lib/types'

const TYPE_META: Record<SuggestionType, { label: string; color: string; dot: string }> = {
  answer: {
    label: 'ANSWER',
    color: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-800 dark:hover:border-emerald-600',
    dot: 'bg-emerald-500',
  },
  question: {
    label: 'QUESTION TO ASK',
    color: 'bg-blue-50 border-blue-200 hover:border-blue-400 dark:bg-blue-900/20 dark:border-blue-800 dark:hover:border-blue-600',
    dot: 'bg-blue-500',
  },
  talking_point: {
    label: 'TALKING POINT',
    color: 'bg-amber-50 border-amber-200 hover:border-amber-400 dark:bg-amber-900/20 dark:border-amber-800 dark:hover:border-amber-600',
    dot: 'bg-amber-500',
  },
  fact_check: {
    label: 'FACT CHECK',
    color: 'bg-rose-50 border-rose-200 hover:border-rose-400 dark:bg-rose-900/20 dark:border-rose-800 dark:hover:border-rose-600',
    dot: 'bg-rose-500',
  },
  clarification: {
    label: 'CLARIFICATION',
    color: 'bg-purple-50 border-purple-200 hover:border-purple-400 dark:bg-purple-900/20 dark:border-purple-800 dark:hover:border-purple-600',
    dot: 'bg-purple-500',
  },
}

interface Props {
  suggestion: Suggestion
  faded?: boolean
  onClick: (suggestion: Suggestion) => void
}

export default function SuggestionCard({ suggestion, faded, onClick }: Props) {
  const meta = TYPE_META[suggestion.type] ?? TYPE_META.talking_point

  return (
    <button
      onClick={() => onClick(suggestion)}
      className={`w-full text-left rounded-xl border p-3.5 transition-all duration-150 cursor-pointer ${meta.color} ${
        faded ? 'opacity-40' : 'opacity-100'
      }`}
    >
      {/* Type badge */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
          {meta.label}
        </span>
      </div>

      {/* Preview text */}
      <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug font-medium">{suggestion.preview}</p>
    </button>
  )
}
