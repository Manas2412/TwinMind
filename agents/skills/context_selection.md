# Skill: Context Selection

## Goal
Select the most relevant transcript portion for suggestions.

## Rules

- Prioritize last 30 seconds
- Include speaker intent signals:
  - questions
  - decisions
  - confusion

## Strategy

1. Extract last N lines
2. Remove filler/noise
3. Keep only meaningful statements

## Output
Cleaned transcript context