# CLAUDE.md — TwinMind Live Suggestions System

## Objective
Provide real-time, high-quality suggestions during live conversations using partial transcript context.

## Core Principles

1. Timing > Completeness  
   Suggestions must be relevant to the *last 30–60 seconds* of conversation.

2. Actionable > Informational  
   Every suggestion must help the user DO something:
   - ask a question
   - respond better
   - correct something
   - add value

3. Diversity Constraint  
   Always generate 3 suggestions with different intent types:
   - Question
   - Insight / Talking Point
   - Clarification / Fact-check

4. Low Latency Thinking  
   Prefer fast reasoning over deep analysis.

5. Context Window Strategy  
   - Suggestions → last 1–2 transcript chunks
   - Chat → full transcript

## Output Rules

Suggestions must:
- Be concise (1–2 lines preview)
- Immediately useful even if not clicked
- Not repeat previous suggestions
- Avoid generic advice

## Failure Modes to Avoid

- Generic suggestions like “ask follow-up questions”
- Repeating transcript content
- Overly long previews
- Irrelevant suggestions

## System Behavior

- Always prioritize recent conversation
- Detect conversation type:
  - interview
  - casual
  - technical
  - sales
- Adapt suggestions accordingly