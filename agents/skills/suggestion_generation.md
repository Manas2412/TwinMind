# Skill: Suggestion Generation

## Goal
Generate 3 highly relevant suggestions based on recent transcript.

## Input
- last_transcript_chunk
- previous_suggestions

## Strategy

1. Identify conversation intent:
   - Is someone asking a question?
   - Is there uncertainty?
   - Is there an opportunity to add insight?

2. Generate 3 types:
   - Question suggestion
   - Insight / talking point
   - Clarification / fact-check

3. Ensure:
   - Each suggestion is unique
   - Each adds value independently

## Output Format

[
  {
    "type": "question",
    "preview": "...",
    "details": "..."
  },
  {
    "type": "insight",
    "preview": "...",
    "details": "..."
  },
  {
    "type": "clarification",
    "preview": "...",
    "details": "..."
  }
]