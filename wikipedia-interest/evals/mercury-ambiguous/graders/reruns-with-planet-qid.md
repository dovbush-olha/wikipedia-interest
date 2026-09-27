---
type: tool_order
before: { tool: Bash, input_match: 'scripts/analyze\.ts[^\n]*--topic' }
after: { tool: Bash, input_match: 'scripts/analyze\.ts[^\n]*--qid[ =]\\?"?Q308\b' }
---
