# Agent Memory Template

Copy this file to `.agent-memory/MEMORY.md` when setting up a new local workspace. The memory file is intentionally local and must not be committed.

Read the memory before starting a task. After completing a task, append one entry using the format below. Keep each entry to roughly 5–8 lines and record outcomes and reasoning rather than Git diff details.

```md
## YYYY-MM-DD — Task name

- Goal: What the task was intended to achieve.
- Key changes: The important behavior or structure that changed.
- Decisions/constraints: Why this approach was chosen and any constraints to preserve.
- Verification: Checks or tests performed and their results.
- Remaining work: Follow-up items, known limitations, or `None`.
```

Repository files and Git history are authoritative if they conflict with memory. Never record secrets or sensitive personal data. Promote long-lived architectural decisions to a tracked ADR or design document.
