# SelfOS Work Continuity Engine — Architecture & Implementation Plan

## 1. System Architecture Overview

The Work Continuity Engine provides resilient, cross-agent handoffs and uninterrupted state tracking across ChatGPT, Cursor, and any authorized MCP client.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI Clients & Agents                             │
│   (ChatGPT via OAuth / Cursor via IDE / Antigravity / CLI Tools)       │
└───────────────────▲──────────────────────────────────▲─────────────────┘
                    │ MCP Tools                        │ REST / UI
                    ▼                                  ▼
┌───────────────────────────────────────┐  ┌─────────────────────────────┐
│       SelfOS MCP Server (:3001)       │  │   Next.js Dashboard (:3000) │
│ - withAuth & Session Fallback         │  │ - /continuity Dashboard Page │
│ - Continuity Service & Validation     │  │ - Task Details, Diffs & Code│
│ - Content-Addressed Deduplication     │  │ - Checkpoint Timeline       │
│ - Storage Budget & Quota Engine       │  │ - Interactive Action Bar    │
└───────────────────┬───────────────────┘  └──────────────┬──────────────┘
                    │                                     │
                    ▼                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Dual-Engine Durable Persistence                      │
│ 1. Supabase PostgreSQL (Remote RLS: continuity_* tables)               │
│ 2. Local Atomic Content-Addressed Store (mcp-server-alpic/data/continuity)│
│    - Immutable Content Blobs (SHA-256 deduplicated)                    │
│    - Versioned Task State & Transitions Ledger                         │
│    - Configurable Storage Budget & Cleanup Enforcer                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. State Model & Transition Rules

Allowed States:
`queued` ➔ `in_progress` ➔ `checkpointing` ➔ `paused` ➔ `interrupted` ➔ `waiting_for_agent` ➔ `resuming` ➔ `validating` ➔ `completed` ➔ `failed` ➔ `cancelled`

Transition Validation Matrix:
- `queued` ➔ `in_progress`, `cancelled`
- `in_progress` ➔ `checkpointing`, `paused`, `interrupted`, `waiting_for_agent`, `validating`, `failed`, `cancelled`
- `checkpointing` ➔ `in_progress`, `paused`, `interrupted`, `waiting_for_agent`, `validating`
- `paused` ➔ `resuming`, `cancelled`
- `interrupted` ➔ `resuming`, `waiting_for_agent`, `failed`, `cancelled`
- `waiting_for_agent` ➔ `resuming`, `cancelled`
- `resuming` ➔ `in_progress`, `validating`, `failed`
- `validating` ➔ `completed`, `in_progress`, `failed`
- `failed` ➔ `resuming`, `cancelled`
- `completed` ➔ (terminal, or `resuming` for follow-up iteration)
- `cancelled` ➔ (terminal)

---

## 3. Database Schema (Migration `00012_create_work_continuity_engine.sql`)

1. **`continuity_tasks`**:
   - `id` (UUID), `project_id` (TEXT), `user_id` (UUID), `title` (TEXT), `objective` (TEXT), `plan` (JSONB),
   - `current_state` (TEXT), `source_platform` (TEXT), `source_agent` (TEXT), `latest_checkpoint_id` (UUID),
   - `budget_bytes` (BIGINT), `used_bytes` (BIGINT), `created_at`, `updated_at`.
2. **`continuity_state_transitions`**:
   - `id` (UUID), `task_id` (UUID), `from_state` (TEXT), `to_state` (TEXT), `trigger` (TEXT),
   - `platform` (TEXT), `agent` (TEXT), `checkpoint_id` (UUID), `error_details` (JSONB), `created_at`.
3. **`continuity_artifacts`**:
   - `id` (UUID), `task_id` (UUID), `path` (TEXT), `version` (INT), `content_hash` (TEXT SHA-256),
   - `content` (TEXT), `diff` (TEXT), `status` (TEXT: `planned`, `partially_generated`, `persisted`, `applied`, `validated`, `completed`),
   - `size_bytes` (INT), `parent_version` (INT), `metadata` (JSONB), `created_at`.
4. **`continuity_checkpoints`**:
   - `id` (UUID), `task_id` (UUID), `name` (TEXT), `summary` (TEXT), `completed_steps` (JSONB),
   - `pending_steps` (JSONB), `next_recommended_action` (TEXT), `artifact_snapshots` (JSONB),
   - `git_ref` (TEXT), `created_at`.

---

## 4. MCP Server Tools Added

1. `create-continuity-task`: Initialize a new tracked task with requirements and budget.
2. `update-task-state`: Perform validated, audited state transitions.
3. `save-artifact`: Persist partial or completed code/diffs with SHA-256 hashing and secret redaction.
4. `get-artifact`: Retrieve exact recoverable code for any artifact and version.
5. `create-checkpoint`: Capture a full point-in-time recovery snapshot.
6. `get-checkpoint`: Retrieve snapshot details and step list.
7. `list-checkpoints`: Timeline of checkpoints for a task.
8. `resume-task`: Generate an agent-neutral continuation package with exact files, diffs, and next action.
9. `pause-task`: Gracefully checkpoint and pause an active task.
10. `get-task-status`: Full status, progress metrics, and storage quota health.
11. `create-handoff`: Export a provider-neutral handoff package for another AI client.
12. `check-storage-budget`: Check usage against normal/warning/critical thresholds.

---

## 5. Dashboard Implementation

- **Sidebar Integration**: Added `Work Continuity` link with status indicator.
- **`/continuity` Route**: Full project continuity console:
  - Tasks list with live state badges (`in_progress`, `paused`, `interrupted`, etc.).
  - Storage usage gauge with warning/critical threshold indicators.
  - Interactive Action controls: Pause, Resume, Checkpoint, Restore, Export Handoff.
  - Task Detail Drawer: Code preview, diffs, step checklist, transition timeline.
