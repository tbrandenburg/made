---
description: Resolve CI errors with a structured task file
argument-hint: <url>
---

Finish or fix following task(s) completely without stopping:

1. Analyze `$ARGUMENTS` and perform a root cause analysis with asking 5xWhy
2. Plan the fix
3. Implement the plan
4. Commit and push
5. Observe CI and iterate till it is passing

—-

For each task create an entry in:

MANDATORY OUTPUT ARTIFACT: Create `./dev/state/task-ledger.json` newly with schema:

```markdown
{
  "TASK_ID": {
    "status": "pending | in_progress | blocked | done",
    "evidence": ["exact command + output snippet"],
    "last_verified": "ISO-8601 timestamp"
  }
}
```
 
This file is the single source of truth for todo and task tracking
 
Before starting any task:
- Load task-ledger.json
- Restate which task IDs are NOT done
- Select exactly ONE task to work on

After each task:
- Update its status
- Add new critical or important tasks if needed
 
### Effect
- Tasks cannot be forgotten
- Every task must be re‑acknowledged continuously
- Evidence becomes mandatory, not optional

—-