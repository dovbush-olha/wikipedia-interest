---
type: tool_order
before: { tool: Bash, input_match: 'scripts/analyze\.ts.*--langs[ =]\\?"?[a-z,]*\bsk\b' }
after: { tool: Bash, input_match: 'scripts/report\.ts' }
---
