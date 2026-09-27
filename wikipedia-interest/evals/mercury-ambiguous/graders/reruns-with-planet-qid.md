---
type: tool_order
before: { tool: Bash, input_match: 'scripts/analyze\.ts.*--topic' }
after: { tool: Bash, input_match: 'scripts/analyze\.ts.*--qid[ =]\\?"?Q308\b' }
---
