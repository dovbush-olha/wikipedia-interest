---
description: "Example 3 of the task: learning English has no article of its own, so the English language is measured as a proxy."
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
env:
  EVAL_WIKI_INTEREST_NOW: "2026-09-15"
  EVAL_WIKI_INTEREST_CACHE_DIR: tests/fixtures/task-examples
  EVAL_WIKI_INTEREST_OFFLINE: "1"
---

Ми створюємо застосунок для вивчення мов. Порівняй інтерес до вивчення англійської у вибраних нами мовних розділах (українському, польському та чеському) та підготуй короткий звіт: які аудиторії варто дослідити наступними й чому?
