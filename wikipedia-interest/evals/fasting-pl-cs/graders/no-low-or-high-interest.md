---
type: regex
target: last_message
pattern: '(низьк|висок)\S* (інтерес|попит)|(інтерес|попит)\S* (низьк|висок)|(low|high) (interest|demand)|(interest|demand) (is |was )?(low|high)'
flags: i
match: not_contains
---
