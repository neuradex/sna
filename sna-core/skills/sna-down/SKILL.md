---
name: sna-down
description: Stop the full SNA environment. Usage: /sna-down
allowed-tools:
  - Bash(pnpm sna:down)
  - Bash(pnpm sna:status)
---

# lna-down

Stop the full LLM-Native Application environment.

## Steps

1. Run:

```bash
pnpm sna:down
```

2. Report what was stopped (PID, port).

3. If nothing was running, say so clearly.
