---
description: "Example 2 of the task, one language edition and a question about trend reliability."
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
env:
  EVAL_WIKI_INTEREST_NOW: "2026-09-15"
  EVAL_WIKI_INTEREST_CACHE_DIR: tests/fixtures/task-examples
  EVAL_WIKI_INTEREST_OFFLINE: "1"
---

Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?
