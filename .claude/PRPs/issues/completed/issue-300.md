# Investigation: Critical: Add runtime version visibility (API + UI)

**Issue**: #300 (https://github.com/tbrandenburg/made/issues/300)
**Type**: ENHANCEMENT
**Investigated**: 2026-04-28T00:00:00.000Z

### Assessment

| Metric     | Value  | Reasoning                                                                                                      |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Priority   | HIGH   | Explicitly labelled `priority/high` and `severity/high`; blocks production support and deployment verification |
| Complexity | MEDIUM | 4 files across backend and frontend with one API integration point between them                                |
| Confidence | HIGH   | All affected files are identified, patterns are clear, nothing is ambiguous                                    |

---

## Problem Statement

The application has no mechanism to expose the running version to users or operators. Neither a `/api/version` endpoint, nor any version field in `/api/health`, nor any version display in the frontend Sidebar exist. This is a pure net-new feature; no partial implementation is present.

---

## Analysis

### Change Rationale

This is a new feature addition. The version string `"0.1.0"` exists in both `packages/pybackend/pyproject.toml:3` and `packages/frontend/package.json:3` but is never served via HTTP or shown in the UI. The issue (and a follow-up comment from the repository owner) also specifies that the version must be displayed **small font, center aligned in the sidebar menu bar** — specifically below the "MADE" title.

### Affected Files

| File                                                   | Lines     | Action | Description                                     |
| ------------------------------------------------------ | --------- | ------ | ----------------------------------------------- |
| `packages/pybackend/app.py`                            | 208–214   | UPDATE | Add `/api/version` endpoint; add version to health |
| `packages/pybackend/tests/unit/test_api.py`            | END       | UPDATE | Add `TestVersionEndpoint` and update health test |
| `packages/frontend/src/components/Sidebar.tsx`         | 35–59     | UPDATE | Fetch and display version below sidebar header  |
| `packages/frontend/src/styles/sidebar.css`             | END       | UPDATE | Add `.sidebar-version` styles                   |

### Integration Points

- `packages/pybackend/app.py:208` — health endpoint is the pattern to follow for the new version endpoint
- `packages/frontend/src/components/Sidebar.tsx:38` — `"MADE"` header `<div>` is the insertion point; version goes directly below it
- `packages/frontend/src/styles/sidebar.css` — imported by Sidebar.tsx; add styles here

### Git History

- No version-related endpoints or UI have ever been added — this is first implementation.

---

## Implementation Plan

### Step 1: Add `/api/version` endpoint and update `/api/health`

**File**: `packages/pybackend/app.py`
**Lines**: 1–15 (imports), 208–214 (health endpoint)
**Action**: UPDATE

**Add at the top of the file (after existing imports, before `app = FastAPI(...)`):**

```python
import importlib.metadata

_VERSION = importlib.metadata.version("made-pybackend")
```

> `importlib.metadata.version` reads the installed package version from `pyproject.toml` without file I/O at request time. The package name `"made-pybackend"` must match the `name` field in `packages/pybackend/pyproject.toml`.

**Current health endpoint (lines 208–214):**

```python
@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "workspace": str(get_workspace_home()),
        "made": str(get_made_directory()),
    }
```

**Replace with:**

```python
@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "version": _VERSION,
        "workspace": str(get_workspace_home()),
        "made": str(get_made_directory()),
    }


@app.get("/api/version")
def get_version():
    return {
        "version": _VERSION,
        "commit_sha": os.environ.get("COMMIT_SHA", "unknown"),
        "build_date": os.environ.get("BUILD_DATE", "unknown"),
        "environment": os.environ.get("ENVIRONMENT", "development"),
    }
```

**Why**: `importlib.metadata` is the idiomatic Python way to read the installed package version; `os` is already imported (`import os` at line 6).

---

### Step 2: Add tests for version endpoint and update health test

**File**: `packages/pybackend/tests/unit/test_api.py`
**Action**: UPDATE (append new class; update existing health test)

**Update existing health test** to assert `version` field is present:

```python
# In TestHealthEndpoint.test_health_check_success, add assertion:
assert "version" in data
```

**Append new test class:**

```python
class TestVersionEndpoint:
    """Test the /api/version endpoint."""

    def test_version_returns_version_string(self):
        """Version endpoint returns a version field."""
        response = client.get("/api/version")

        assert response.status_code == 200
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    def test_version_includes_metadata_fields(self):
        """Version endpoint returns all required metadata fields."""
        response = client.get("/api/version")

        data = response.json()
        assert "commit_sha" in data
        assert "build_date" in data
        assert "environment" in data
```

---

### Step 3: Display version in Sidebar (small font, center aligned, below MADE header)

**File**: `packages/frontend/src/components/Sidebar.tsx`
**Lines**: 10, 35–59
**Action**: UPDATE

**Current imports (lines 9–12):**

```tsx
import { RecurringTasksIcon } from "./icons/RecurringTasksIcon";
import React from "react";
import { NavLink } from "react-router-dom";
import "../styles/sidebar.css";
```

**Replace with:**

```tsx
import { RecurringTasksIcon } from "./icons/RecurringTasksIcon";
import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import "../styles/sidebar.css";
```

**Current component body (lines 35–59):**

```tsx
export const Sidebar: React.FC<SidebarProps> = ({ open, onNavigate }) => {
  return (
    <nav className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">MADE</div>
      <ul>
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={onNavigate}
              >
                <Icon />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
```

**Replace with:**

```tsx
export const Sidebar: React.FC<SidebarProps> = ({ open, onNavigate }) => {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data: { version: string }) => setVersion(data.version))
      .catch(() => setVersion(""));
  }, []);

  return (
    <nav className={`sidebar ${open ? "open" : ""}`}>
      <div className="sidebar-header">MADE</div>
      {version && <div className="sidebar-version">v{version}</div>}
      <ul>
        {MENU_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={onNavigate}
              >
                <Icon />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
```

**Why**: The owner's comment explicitly requested "small font center aligned in the menu bar" — placed directly below the "MADE" title is the natural location. Version is fetched once on mount; silently omitted on error to avoid broken UI.

---

### Step 4: Add `.sidebar-version` CSS

**File**: `packages/frontend/src/styles/sidebar.css`
**Action**: UPDATE (append at end of file)

**Append:**

```css
.sidebar-version {
  font-size: 0.7rem;
  text-align: center;
  color: var(--muted);
  margin-top: -1rem;
}
```

**Why**: `font-size: 0.7rem` is noticeably smaller than the `1.5rem` header; `text-align: center` fulfills the owner's explicit request; negative `margin-top` tightens the gap with the header above; `var(--muted)` keeps it visually subtle.

---

## Patterns to Follow

**Backend endpoint pattern — mirror `health_check` at `app.py:208–214`:**

```python
@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "workspace": str(get_workspace_home()),
        "made": str(get_made_directory()),
    }
```

**Backend test pattern — mirror `TestHealthEndpoint` at `test_api.py:15–32`:**

```python
class TestHealthEndpoint:
    @patch("app.get_workspace_home")
    @patch("app.get_made_directory")
    def test_health_check_success(self, mock_made_dir, mock_workspace_home):
        mock_workspace_home.return_value = "/test/workspace"
        mock_made_dir.return_value = "/test/made"

        response = client.get("/api/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
```

**Frontend hook pattern — `useEffect` + `useState` for one-time fetch (standard React).**

---

## Edge Cases & Risks

| Risk / Edge Case                           | Mitigation                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `importlib.metadata` can't find package    | Wrap in `try/except` and fall back to `"unknown"` if needed       |
| Package name mismatch in pyproject.toml    | Verify `name` field in `packages/pybackend/pyproject.toml` first  |
| `/api/version` unavailable when sidebar mounts | `catch` sets `version` to `""` → version `<div>` not rendered |
| `margin-top: -1rem` too aggressive visually | Adjust to `margin-top: -0.75rem` if gap looks off in the browser  |

---

## Validation

### Automated Checks

```bash
# Backend unit tests
cd packages/pybackend && uv run python -m pytest tests/unit/test_api.py -v

# Frontend type check + build
cd packages/frontend && npm run build

# Full QA
make qa-quick
```

### Manual Verification

1. Start the app: `make run`
2. `curl http://localhost:3000/api/version` → JSON with `version`, `commit_sha`, `build_date`, `environment`
3. `curl http://localhost:3000/api/health` → JSON includes `version` field
4. Open `http://localhost:5173` → sidebar shows `v0.1.0` in small centered text below "MADE"

---

## Scope Boundaries

**IN SCOPE:**
- `GET /api/version` endpoint returning version + env metadata
- `GET /api/health` updated to include version
- Sidebar version display (small, center-aligned, below header)
- CSS for `.sidebar-version`
- Unit tests for new endpoint and updated health test

**OUT OF SCOPE (do not touch):**
- Build-time injection of `COMMIT_SHA` / `BUILD_DATE` (CI/CD concern)
- About dialog
- Version display in header or any other UI location
- Frontend `useApi.ts` wrapper (direct `fetch` in Sidebar is sufficient and simpler)
- Docker/container changes

---

## Metadata

- **Investigated by**: Claude
- **Timestamp**: 2026-04-28T00:00:00.000Z
- **Artifact**: `.claude/PRPs/issues/issue-300.md`
