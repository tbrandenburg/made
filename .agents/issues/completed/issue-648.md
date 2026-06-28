# Investigation: Add per-step delete control in the Workflow Builder

**Issue**: [#648](https://github.com/tbrandenburg/made/issues/648)
**Type**: ENHANCEMENT
**Investigated**: 2026-06-28T14:35:00Z

### Assessment

| Metric | Value | Reasoning |
| --- | --- | --- |
| Priority | MEDIUM | This is a user-facing workflow editing gap, but the existing workaround is to delete and rebuild the workflow, so it is not blocking core app use. |
| Complexity | LOW | The change is localized to one React component plus one focused component test, with no API or backend contract changes. |
| Confidence | HIGH | The current code path is clear, the missing control is visible in the render tree, and there is no linked PR already addressing the issue. |

## Problem Statement

The Harness Builder renders workflow steps with move-up and move-down controls, but individual steps cannot be removed. The workflow itself can be deleted, yet users still need a per-step delete action for `agent`, `bash`, and `vars` steps to edit workflows efficiently.

## Analysis

### Change Rationale

The fix is to add a delete button inside the existing `workflow-step-controls` container in `packages/frontend/src/components/WorkflowBuilderPanel.tsx`, using the same delete pattern already used for whole workflows. The current persistence flow already saves the full workflow list immediately, so removing a step only needs to filter that workflow's `steps` array and call `persist(next)`.

### Evidence Chain

WHY: A user cannot remove an individual workflow step
↓ BECAUSE: The step-row action area only renders move-up and move-down buttons
Evidence: `packages/frontend/src/components/WorkflowBuilderPanel.tsx:536-586` - the `workflow-step-controls` block ends after the move-down button

↓ BECAUSE: No delete control was implemented in the step-row template
Evidence: `packages/frontend/src/components/WorkflowBuilderPanel.tsx:560-585` - the only actions in that block are move-up and move-down

↓ ROOT CAUSE: The step row render lacks a `TrashIcon` button wired to remove the current `stepIndex`
Evidence: `packages/frontend/src/components/WorkflowBuilderPanel.tsx:536-586` - no deletion branch exists for step rows

### Affected Files

| File | Lines | Action | Description |
| --- | --- | --- | --- |
| `packages/frontend/src/components/WorkflowBuilderPanel.tsx` | 536-586 | UPDATE | Add a per-step delete button and handler in the step controls block. |
| `packages/frontend/src/components/WorkflowBuilderPanel.test.tsx` | NEW | CREATE | Cover rendering and deletion behavior for step rows, including persistence callback invocation. |

### Integration Points

- `packages/frontend/src/components/HarnessesTab.tsx:239-245` passes `saveWorkflows` through to `WorkflowBuilderPanel`; no caller changes are needed.
- `packages/frontend/src/components/WorkflowBuilderPanel.tsx:179-195` already persists the full workflow list through `saveWorkflows`, so step removal can reuse the existing save flow.
- `packages/frontend/src/styles/page.css:376-388` already defines `workflow-icon-button--danger`, so the new control can reuse the existing visual danger style.

### Git History

- **Introduced**: `5e58a52` - 2026-03-04 - "Add workflow builder panel with YAML-backed workflow APIs"
- **Last modified**: `61baf36` - 2026-06-24 - "Fix: remove sourceFile from workflow schema (#541) (#543)"
- **Implication**: This appears to be a long-standing missing feature, not a regression introduced by a recent fix.

## Implementation Plan

### Step 1: Add a per-step remove button

**File**: `packages/frontend/src/components/WorkflowBuilderPanel.tsx`
**Lines**: 560-586
**Action**: UPDATE

**Current code:**

```tsx
                        <div className="workflow-step-controls">
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === 0}
                            title="Move step up"
                            aria-label="Move step up"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (item.id !== workflow.id || stepIndex === 0)
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex - 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex - 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--up">
                              <ArrowDownIcon />
                            </span>
                          </button>
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === workflow.steps.length - 1}
                            title="Move step down"
                            aria-label="Move step down"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (
                                  item.id !== workflow.id ||
                                  stepIndex >= item.steps.length - 1
                                )
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex + 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex + 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--down">
                              <ArrowDownIcon />
                            </span>
                          </button>
                        </div>
```

**Required change:**

```tsx
                        <div className="workflow-step-controls">
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === 0}
                            title="Move step up"
                            aria-label="Move step up"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (item.id !== workflow.id || stepIndex === 0)
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex - 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex - 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--up">
                              <ArrowDownIcon />
                            </span>
                          </button>
                          <button
                            className="copy-button workflow-icon-button"
                            disabled={stepIndex === workflow.steps.length - 1}
                            title="Move step down"
                            aria-label="Move step down"
                            onClick={() => {
                              const next = workflows.map((item) => {
                                if (
                                  item.id !== workflow.id ||
                                  stepIndex >= item.steps.length - 1
                                )
                                  return item;
                                const steps = [...item.steps];
                                [steps[stepIndex + 1], steps[stepIndex]] = [
                                  steps[stepIndex],
                                  steps[stepIndex + 1],
                                ];
                                return { ...item, steps };
                              });
                              void persist(next);
                            }}
                          >
                            <span className="workflow-icon workflow-icon--down">
                              <ArrowDownIcon />
                            </span>
                          </button>
                          <button
                            className="copy-button workflow-icon-button workflow-icon-button--danger"
                            title="Remove step"
                            aria-label={`Remove step ${stepIndex + 1}`}
                            onClick={() => {
                              if (
                                editStep?.workflowId === workflow.id &&
                                editStep.stepIndex === stepIndex
                              ) {
                                setEditStep(null);
                                setEditStepValue("");
                              }
                              const next = workflows.map((item) =>
                                item.id === workflow.id
                                  ? {
                                      ...item,
                                      steps: item.steps.filter(
                                        (_, index) => index !== stepIndex,
                                      ),
                                    }
                                  : item,
                              );
                              void persist(next);
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </div>
```

**Why**: This matches the existing workflow-level delete pattern (`TrashIcon`, danger button class, immediate persistence) and avoids introducing a confirmation flow or new state model.

### Step 2: Add a focused component test

**File**: `packages/frontend/src/components/WorkflowBuilderPanel.test.tsx`
**Action**: CREATE

**Test cases to add:**

```tsx
describe("WorkflowBuilderPanel", () => {
  it("renders a remove button for each workflow step", async () => {
    // render panel with one workflow containing agent/bash/vars steps
    // assert each step row exposes a remove button by accessible name
  });

  it("removes a step and persists the updated workflow list", async () => {
    // click the remove button for a middle step
    // assert saveWorkflows is called with that step filtered out
    // assert the removed step no longer renders
  });

  it("closes the step editor when deleting the step being edited", async () => {
    // open the edit modal for a step
    // delete that same step
    // assert the modal closes and no stale editor state remains
  });
});
```

**Why**: This is the smallest high-signal test file that proves the feature end-to-end in the component without touching unrelated pages or backend code.

### Step 3: Keep the change scoped to the builder UI

**File**: `packages/frontend/src/components/WorkflowBuilderPanel.tsx`
**Action**: UPDATE

**Do not change**:

- `packages/frontend/src/components/HarnessesTab.tsx`
- backend workflow APIs
- CSS files
- the workflow list schema

The step removal behavior already works through the existing save path, so no integration changes are needed outside the builder component.

## Patterns to Follow

**From codebase - mirror these exactly:**

```tsx
// SOURCE: packages/frontend/src/components/WorkflowBuilderPanel.tsx:383-394
// Pattern for destructive workflow actions
<button
  className="copy-button workflow-icon-button workflow-icon-button--danger"
  title="Remove workflow"
  aria-label="Remove workflow"
  onClick={() =>
    void persist(
      workflows.filter((item) => item.id !== workflow.id),
    )
  }
>
  <TrashIcon />
</button>
```

```tsx
// SOURCE: packages/frontend/src/components/WorkflowBuilderPanel.tsx:542-579
// Pattern for mutating a single workflow and persisting immediately
const next = workflows.map((item) => {
  if (item.id !== workflow.id || stepIndex === 0) return item;
  const steps = [...item.steps];
  [steps[stepIndex - 1], steps[stepIndex]] = [
    steps[stepIndex],
    steps[stepIndex - 1],
  ];
  return { ...item, steps };
});
void persist(next);
```

## Edge Cases & Risks

| Risk/Edge Case | Mitigation |
| --- | --- |
| Deleting the step currently open in the edit modal | Clear `editStep` and `editStepValue` before persisting so the modal cannot save a stale index. |
| Removing the last remaining step | Let the workflow show the existing `No steps yet.` empty state; this is already handled by the component. |
| Delete button accessibility | Use a stable accessible name such as `Remove step ${stepIndex + 1}` so each control is uniquely reachable. |

## Validation

### Automated Checks

```bash
npm --workspace packages/frontend run test -- WorkflowBuilderPanel.test.tsx
npm --workspace packages/frontend run lint
npm --workspace packages/frontend run build
```

### Manual Verification

1. Open the Harness Builder and expand a workflow with multiple steps.
2. Verify each step row shows a danger-styled delete button next to move controls.
3. Delete a middle step and confirm it disappears immediately and remains deleted after reload.
4. Open the step editor for a step, delete that same step, and confirm the editor closes cleanly.

## Scope Boundaries

**IN SCOPE:**

- Add a per-step delete control to `WorkflowBuilderPanel.tsx`
- Persist the updated workflow immediately through the existing `persist()` flow
- Add a focused component test covering rendering and deletion behavior

**OUT OF SCOPE (do not touch):**

- Backend workflow storage or YAML serialization
- Changes to the Harness Builder entrypoint wiring
- Confirmation dialogs for deletion
- CSS redesign or icon changes
- Broad refactors of workflow editing behavior

## Metadata

- **Investigated by**: issue-resolution-workflow
- **Timestamp**: 2026-06-28T14:35:00Z
- **Artifact**: `.agents/issues/issue-648.md`
