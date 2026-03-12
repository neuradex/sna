---
name: devlog-analyze
description: Analyze coding patterns and provide actionable insights. Usage: /devlog-analyze
allowed-tools:
  - Bash(tsx src/scripts/devlog.ts *)
  - Bash(tsx src/scripts/emit.ts *)
---

# devlog-analyze

Read the dev log data and produce a meaningful analysis of coding patterns, productivity, and focus areas.

## Steps

0. Emit called (lifecycle hook — always first):

```bash
tsx src/scripts/emit.ts --skill devlog-analyze --type called --message "devlog-analyze invoked"
```

1. Export the data as JSON:

```bash
tsx src/scripts/devlog.ts export
```

2. Analyze the JSON output. Cover:

   **Productivity patterns**
   - Most active days of the week and times of day
   - Longest coding streaks (consecutive active days)
   - Average commits per active day

   **Focus areas**
   - Which repos/projects are getting the most attention
   - Are there repos that haven't been touched in a while?
   - Ratio of feature work vs fixes (infer from commit messages)

   **Code volume**
   - Lines added vs deleted trend — is the codebase growing or being refined?
   - Most significant commits (highest insertions)

3. Generate 3 concrete, actionable insights based on the data.
   - Be specific. "You commit mostly at 10am and 2pm — consider blocking those as deep work hours."
   - Not generic. Never say "keep up the good work."

4. Emit milestone for each insight generated:

```bash
tsx src/scripts/emit.ts --skill devlog-analyze --type milestone --message "<key insight in one line>"
```

5. Save one key insight to the database for the dashboard:

```bash
tsx src/scripts/devlog.ts add-note --note "YOUR_KEY_INSIGHT_HERE"
```

6. Emit success (lifecycle hook — always last on success):

```bash
tsx src/scripts/emit.ts --skill devlog-analyze --type success --message "Analysis complete."
```

On error, emit failed before reporting:

```bash
tsx src/scripts/emit.ts --skill devlog-analyze --type failed --message "Failed: <reason>"
```

7. Report back to the user in this structure:
   - Summary (2-3 sentences)
   - Top 3 insights (with supporting data)
   - One suggested action for this week

## Tone

- Direct, data-driven. Show the numbers.
- Treat the user as a senior engineer who wants signal, not noise.
