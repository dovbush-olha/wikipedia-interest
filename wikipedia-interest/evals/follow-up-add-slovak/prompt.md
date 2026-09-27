---
description: "A follow-up to example 1: the conversation so far is the first analysis, and adding Slovak needs a new analysis with sk in --langs."
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
env:
  EVAL_WIKI_INTEREST_NOW: "2026-09-15"
  EVAL_WIKI_INTEREST_CACHE_DIR: tests/fixtures/task-examples
  EVAL_WIKI_INTEREST_OFFLINE: "1"
---

А тепер додай словацьку.
