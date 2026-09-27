---
description: "An ambiguous topic: Mercury is a disambiguation page, so the model picks the planet from the candidates and reruns with --qid."
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
env:
  EVAL_WIKI_INTEREST_NOW: "2026-09-15"
  EVAL_WIKI_INTEREST_CACHE_DIR: tests/fixtures/mercury-uk-cs-pl
  EVAL_WIKI_INTEREST_OFFLINE: "1"
---

Ми робимо освітній застосунок про Сонячну систему. Порівняй інтерес до Меркурія в україномовній, чеськомовній і польськомовній Wikipedia.
