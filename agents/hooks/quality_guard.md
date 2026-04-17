# Hook: Suggestion Quality Guard

## Runs after suggestion generation

## Checks

1. Are there exactly 3 suggestions?
2. Are they different types?
3. Are they actionable?
4. Are they non-generic?

## Reject if:

- Any suggestion is vague
- Any suggestion repeats transcript
- All suggestions are same type

## Fix Strategy

- Regenerate with stricter instructions