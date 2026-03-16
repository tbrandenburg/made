# Investigation: Add terminate button for running workflows on tasks page

**Issue**: #306 (https://github.com/tbrandenburg/made/issues/306)
**Type**: ENHANCEMENT
**Investigated**: 2026-03-16T12:45:00Z

### Assessment

| Metric     | Value   | Reasoning                                                                                                                                                                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Priority   | MEDIUM  | Issue explicitly states "Medium - quality-of-life improvement that makes existing admin functionality accessible to users through the UI"                                                                                 |
| Complexity | MEDIUM  | Found 3 files to modify (backend API, frontend API hook, frontend UI), follows existing patterns for cancel buttons (RepositoryPage:1630, TaskPage:490), requires coordination between backend and frontend           |
| Confidence | HIGH    | `force_terminate_job()` function already exists and is tested at cron_service.py:436, found clear UI patterns to mirror, API endpoint patterns are well-established, workflow ID format is consistent throughout codebase |

---

## Problem Statement

Users cannot manually stop long-running or stuck workflows from the UI. The backend already has `force_terminate_job()` function (added in recent cron improvements #297), but there's no API endpoint or UI button to access this functionality.

---

## Analysis

### Change Rationale

The cron service improvements added `force_terminate_job()` in `cron_service.py:436-443` as an admin function. However:
1. No API endpoint exists to expose this function to frontend
2. No UI exists in TasksPage to trigger termination for running workflows

This enhancement follows existing patterns:
- Backend: Similar cancel endpoints in `app.py` (lines 435, 871, 1127)
- Frontend: Danger buttons with confirmation in TaskPage, RepositoryPage

### Evidence Chain

ENHANCEMENT: Add UI and API access to existing force_terminate_job()
↓ BECAUSE: Backend function exists but not exposed
Evidence: `cron_service.py:436-443` - `force_terminate_job(workflow_id: str) -> bool`

↓ BECAUSE: No API endpoint exists  
Evidence: `app.py` has cancel endpoints for tasks/repos but none for workflows

↓ BECAUSE: No UI button exists
Evidence: `TasksPage.tsx:180-226` - workflow table has no action buttons, only displays diagnostics

↓ SOLUTION: Add API endpoint + UI button following existing patterns
Evidence: Three similar cancel endpoints exist (app.py:435, 871, 1127) + danger button patterns throughout UI

### Affected Files

| File                                         | Lines     | Action | Description                              |
| -------------------------------------------- | --------- | ------ | ---------------------------------------- |
| `packages/pybackend/app.py`                  | ~630      | CREATE | Add POST /api/workflows/{workflow_id}/terminate endpoint |
| `packages/frontend/src/hooks/useApi.ts`      | ~481      | UPDATE | Add terminateWorkflow API method         |
| `packages/frontend/src/pages/TasksPage.tsx`  | ~200,~240 | UPDATE | Add terminate button and handler logic   |

### Integration Points

- New API endpoint calls `force_terminate_job(workflow_id)` from cron_service
- Frontend button calls new API method on click with confirmation
- UI uses `workflow.diagnostics.running` to show/hide terminate button
- Frontend refreshes workflow list after termination via existing `getWorkspaceWorkflows()`

### Git History

- **force_terminate_job introduced**: 6ba299e - "Fix: Improve cron service code quality with thread safety, error handling, and runtime limits (#297)"
- **TasksPage last modified**: f5e91b4 - "Clarify workflow diagnostics stderr and stdout tail"
- **Implication**: Recent addition of function, stable TasksPage, no conflicts expected

---

## Implementation Plan

### Step 1: Add terminate API endpoint

**File**: `packages/pybackend/app.py`
**Lines**: After line 630 (after existing cron endpoints)
**Action**: CREATE

**Required change:**

```python
@app.post("/api/workflows/{workflow_id}/terminate")
def terminate_workflow(workflow_id: str):
    """Terminate a running workflow job."""
    try:
        success = force_terminate_job(workflow_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No active workflow process to terminate",
            )
        return {"success": True, "message": "Workflow terminated successfully"}
    except Exception as e:
        logger.exception(f"Error terminating workflow {workflow_id}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to terminate workflow: {str(e)}",
        )
```

**Why**: Exposes existing force_terminate_job function via REST API following established pattern

---

### Step 2: Add force_terminate_job import

**File**: `packages/pybackend/app.py`
**Lines**: Around line 54-60 (with other cron_service imports)
**Action**: UPDATE

**Current code:**

```python
from cron_service import (
    get_cron_job_diagnostics,
    get_cron_job_last_runs,
    refresh_cron_clock,
    start_cron_clock,
    stop_cron_clock,
)
```

**Required change:**

```python
from cron_service import (
    force_terminate_job,
    get_cron_job_diagnostics,
    get_cron_job_last_runs,
    refresh_cron_clock,
    start_cron_clock,
    stop_cron_clock,
)
```

**Why**: Need to import the function to use it in the new endpoint

---

### Step 3: Add terminateWorkflow API method

**File**: `packages/frontend/src/hooks/useApi.ts`
**Lines**: After line 480 (after getWorkspaceWorkflows)
**Action**: UPDATE

**Current code:**

```typescript
getWorkspaceWorkflows: () =>
    request<{ workflows: WorkspaceWorkflowSummary[] }>("/workspace/workflows"),
```

**Required change:**

```typescript
getWorkspaceWorkflows: () =>
    request<{ workflows: WorkspaceWorkflowSummary[] }>("/workspace/workflows"),
terminateWorkflow: (workflowId: string) =>
    request<{ success: boolean; message?: string }>(`/workflows/${encodeURIComponent(workflowId)}/terminate`, {
        method: "POST",
    }),
```

**Why**: Frontend needs API method to call the new backend endpoint

---

### Step 4: Add terminate button state management

**File**: `packages/frontend/src/pages/TasksPage.tsx`
**Lines**: After line 45 (after existing state declarations)
**Action**: UPDATE

**Current code:**

```tsx
const [createOpen, setCreateOpen] = useState(false);
```

**Required change:**

```tsx
const [createOpen, setCreateOpen] = useState(false);
const [terminatingWorkflow, setTerminatingWorkflow] = useState<string | null>(null);
const [terminateModal, setTerminateModal] = useState(false);
const [selectedWorkflow, setSelectedWorkflow] = useState<WorkspaceWorkflowSummary | null>(null);
```

**Why**: Need state to track termination in progress and confirmation modal

---

### Step 5: Add terminate handler functions

**File**: `packages/frontend/src/pages/TasksPage.tsx`
**Lines**: After line 165 (after existing handlers)
**Action**: UPDATE

**Required change:**

```tsx
const handleTerminate = (workflow: WorkspaceWorkflowSummary) => {
  setSelectedWorkflow(workflow);
  setTerminateModal(true);
};

const handleConfirmTerminate = async () => {
  if (!selectedWorkflow) return;
  
  const workflowId = `${selectedWorkflow.repository}:${selectedWorkflow.id}`;
  setTerminatingWorkflow(workflowId);
  setTerminateModal(false);
  
  try {
    await api.terminateWorkflow(workflowId);
    await refreshWorkspaceWorkflows();
  } catch (error) {
    console.error("Failed to terminate workflow:", error);
    alert(`Failed to terminate workflow: ${error instanceof Error ? error.message : "Unknown error"}`);
  } finally {
    setTerminatingWorkflow(null);
    setSelectedWorkflow(null);
  }
};
```

**Why**: Handle button click and confirmation with proper error handling and loading states

---

### Step 6: Update table header for Actions column

**File**: `packages/frontend/src/pages/TasksPage.tsx`
**Lines**: Line 182-189 (table headers)
**Action**: UPDATE

**Current code:**

```tsx
<th>Enabled</th>
<th>Schedule</th>
<th>Name</th>
<th>Repository</th>
<th>Last run</th>
<th>Diagnostics</th>
```

**Required change:**

```tsx
<th>Enabled</th>
<th>Schedule</th>
<th>Name</th>
<th>Repository</th>
<th>Last run</th>
<th>Diagnostics</th>
<th>Actions</th>
```

**Why**: Need column header for the new terminate button

---

### Step 7: Add terminate button to workflow table

**File**: `packages/frontend/src/pages/TasksPage.tsx`
**Lines**: Line 215-220 (after diagnostics cell)
**Action**: UPDATE

**Current code:**

```tsx
<td>{formatWorkflowLastRun(workflow)}</td>
<td>
  {renderWorkflowDiagnosticsSummary(workflow.diagnostics)}
</td>
</tr>
```

**Required change:**

```tsx
<td>{formatWorkflowLastRun(workflow)}</td>
<td>
  {renderWorkflowDiagnosticsSummary(workflow.diagnostics)}
</td>
<td>
  {workflow.diagnostics?.running && (
    <button
      className="danger"
      onClick={() => handleTerminate(workflow)}
      disabled={terminatingWorkflow === `${workflow.repository}:${workflow.id}`}
      title="Terminate running workflow"
    >
      {terminatingWorkflow === `${workflow.repository}:${workflow.id}` ? "Terminating..." : "Terminate"}
    </button>
  )}
</td>
</tr>
```

**Why**: Adds terminate button that only shows for running workflows with loading state

---

### Step 8: Add confirmation modal

**File**: `packages/frontend/src/pages/TasksPage.tsx`
**Lines**: After line 227 (before closing Panel)
**Action**: UPDATE

**Current code:**

```tsx
        </Panel>
      </div>
```

**Required change:**

```tsx
        </Panel>
        
        <Modal 
          open={terminateModal} 
          title="Terminate Workflow" 
          onClose={() => setTerminateModal(false)}
        >
          <p>Are you sure you want to terminate this job?</p>
          {selectedWorkflow && (
            <p className="muted">Workflow: {selectedWorkflow.name}</p>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setTerminateModal(false)}>
              Cancel
            </button>
            <button className="danger" onClick={handleConfirmTerminate}>
              Terminate
            </button>
          </div>
        </Modal>
      </div>
```

**Why**: Provides confirmation dialog to prevent accidental termination

---

## Patterns to Follow

### Backend API endpoint pattern from app.py:1127-1134

```python
@app.post("/api/tasks/{name}/agent/cancel")
def task_agent_cancel(name: str):
    if not cancel_agent_message(f"task:{name}"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active agent process to cancel",
        )
    return {"success": True}
```

### Frontend danger button pattern from TaskPage.tsx:490

```tsx
<button className="danger" onClick={handleCancel}>
  {agentCancelling ? "Cancelling..." : "Cancel"}
</button>
```

### Modal confirmation pattern from existing components

```tsx
<Modal open={open} title="Action Title" onClose={onCancel}>
  <p>Confirmation message</p>
  <div className="modal-actions">
    <button className="secondary" onClick={onCancel}>Cancel</button>
    <button className="danger" onClick={onConfirm}>Confirm</button>
  </div>
</Modal>
```

---

## Edge Cases & Risks

| Risk/Edge Case                        | Mitigation                                                           |
| ------------------------------------- | -------------------------------------------------------------------- |
| Workflow completes before terminate   | force_terminate_job returns false, API returns 404 with clear message |
| Network failure during request        | Frontend catches error, shows alert, resets state in finally block  |
| Double-click on terminate button      | Button disabled via terminatingWorkflow state during request        |
| Workflow ID encoding issues           | Use encodeURIComponent() in API URL construction                     |
| User cancels confirmation dialog      | Modal state properly reset, no API call made                        |

---

## Validation

### Automated Checks

```bash
# Backend type check and import validation
cd packages/pybackend && uv run mypy app.py

# Backend tests - test existing force_terminate_job function
cd packages/pybackend && uv run python -m pytest tests/unit/test_cron_service.py::test_force_terminate_job -v

# Frontend type check  
cd packages/frontend && npm run type-check

# Frontend tests for TasksPage
cd packages/frontend && npm run test -- TasksPage --run
```

### Manual Verification

1. Start both servers: `make run`
2. Navigate to Tasks page at `http://localhost:5173/tasks` 
3. Verify terminate button appears only next to workflows with `diagnostics.running = true`
4. Click terminate button and verify confirmation dialog appears
5. Cancel dialog and verify no API call made
6. Confirm termination and verify workflow stops running
7. Verify button shows "Terminating..." state during request
8. Test error case with non-existent workflow ID

---

## Scope Boundaries

**IN SCOPE:**

- Add terminate button to TasksPage for running workflows only
- Add backend API endpoint calling existing force_terminate_job()
- Add confirmation dialog with clear messaging
- Handle success/error feedback appropriately

**OUT OF SCOPE (do not touch):**

- Changes to existing force_terminate_job() function behavior
- Real-time polling or WebSocket updates (use existing refresh pattern)
- Permission/authorization system (no auth requirements in issue)
- Bulk terminate operations for multiple workflows
- Terminate buttons in other parts of UI (only TasksPage requested)

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-03-16T12:45:00Z  
- **Artifact**: `.claude/PRPs/issues/issue-306.md`