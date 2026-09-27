---
description: "Example 1 of the task: pl has no article linked in Wikidata, so it is not assessed and never read as low or high attention."
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
env:
  EVAL_WIKI_INTEREST_NOW: "2026-09-15"
  EVAL_WIKI_INTEREST_CACHE_DIR: tests/fixtures/task-examples
  EVAL_WIKI_INTEREST_OFFLINE: "1"
---

Порівняй зростання інтересу до інтервального голодування в польськомовній та чеськомовній Wikipedia за останні два роки.
