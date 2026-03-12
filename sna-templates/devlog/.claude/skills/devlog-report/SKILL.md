---
name: devlog-report
description: Generate a weekly/monthly dev report. Usage: /devlog-report [--week|--month]
allowed-tools:
  - Bash(tsx src/scripts/devlog.ts *)
  - Bash(tsx src/scripts/emit.ts *)
---

# devlog-report

Generate a concise, shareable dev report from your coding activity data.

## Steps

0. Emit called (lifecycle hook — always first):

```bash
tsx src/scripts/emit.ts --skill devlog-report --type called --message "devlog-report invoked"
```

1. Get stats:

```bash
tsx src/scripts/devlog.ts stats
tsx src/scripts/devlog.ts export
```

2. Based on the `--week` or `--month` argument (default: week), filter the data to the relevant time window.

3. Write a report in this format:

```
## Week of [date range]

**What I shipped**
- [Repo]: [summary of main work, inferred from commit messages]
- ...

**By the numbers**
- X commits across Y repos
- +N lines added, -M deleted
- Most active: [day/time]

**Next week focus**
- [1-2 things to tackle based on current trajectory]
```

4. The report should read like something you'd post in a team Slack or weekly standup.
   - Infer context from commit messages intelligently
   - Group related commits into themes
   - Skip trivial commits (chore, typo fixes) in the narrative

5. Emit success (lifecycle hook — always last):

```bash
tsx src/scripts/emit.ts --skill devlog-report --type success --message "Report generated."
```

On error:

```bash
tsx src/scripts/emit.ts --skill devlog-report --type failed --message "Failed: <reason>"
```

## Notes

- If no date argument is given, default to the last 7 days
- Keep the report tight — under 200 words
