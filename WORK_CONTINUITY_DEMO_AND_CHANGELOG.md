# SelfOS Work Continuity Engine — Demo Guide & Changelog

## 1. Executive Summary

The **SelfOS Work Continuity Engine** is a universal, platform-independent continuity layer that guarantees zero lost work across AI agents, tools, IDEs, and models. If an agent hits a token limit, crashes, or is interrupted, any authorized agent (ChatGPT, Cursor IDE, Claude, Antigravity) can resume from the latest verified checkpoint without regenerating completed files or rewriting plans from scratch.

---

## 2. Changelog & Architecture Overview

### A. New MCP Tools (14 New & Extended Tools)
| Tool | Function |
| :--- | :--- |
| `list-tasks` | Discovers all active, paused, or completed tasks with search and state filtering. |
| `create-continuity-task` | Initializes a tracked task with objectives, ordered steps, and storage budget. |
| `resume-task` | Reconstructs files, verifies SHA-256 hashes, and outputs continuation instructions (accepts UUID or Title). |
| `get-task-status` | Real-time task inspection (checkpoints, transitions, budget, steps). |
| `pause-task` | Gracefully checkpoints and pauses an active task. |
| `update-task-state` | Validated state machine transitions with an immutable audit log. |
| `save-artifact` | Saves versioned code/diffs with SHA-256 hashing, secret redaction, and deduplication. |
| `get-artifact` | Retrieves exact recoverable source code for any file and version. |
| `list-artifacts` | Lists all files and versions associated with a task. |
| `create-checkpoint` | Creates point-in-time recovery snapshots with completed/pending steps and next action. |
| `get-checkpoint` | Retrieves a specific checkpoint by ID. |
| `list-checkpoints` | Chronological checkpoint history. |
| `check-storage-budget` | Real-time storage consumption against Normal (70%), Warning (85%), and Critical (95%) thresholds. |
| `create-handoff` | Exports portable, provider-neutral handoff packages (`selfos-continuity-v1`). |

### B. Authentication & Cross-Client Session Sharing
* **File:** `mcp-server-alpic/server/src/auth.ts`
* **Fix:** Added local session caching and fallback for IDE clients like Cursor that invoke MCP tools without OAuth browser headers (`Auth header: NONE`), eliminating `401 Authentication required` errors.

### C. State Machine & Secret Redaction
* **File:** `mcp-server-alpic/server/src/services/continuity-engine.ts`
* **11 States:** `queued`, `in_progress`, `checkpointing`, `paused`, `interrupted`, `waiting_for_agent`, `resuming`, `validating`, `completed`, `failed`, `cancelled`.
* **Automatic Redaction:** Scans and masks OpenAI (`sk-`), GitHub (`ghp_`), JWT tokens, private keys, and passwords before persistence.

### D. Webapp Dashboard (`/continuity`)
* **Page:** `webapp/src/app/(dashboard)/continuity/page.tsx`
* **API Routes:**
  * `webapp/src/app/api/continuity/tasks/route.ts`
  * `webapp/src/app/api/continuity/tasks/[id]/route.ts`
  * `webapp/src/app/api/continuity/tasks/[id]/action/route.ts`
* **Features:**
  * Interactive controls: **Pause**, **Resume**, **Checkpoint**, **Validate**, and **Export Handoff**.
  * Visual Storage Gauge with real-time 50 MB budget tracking.
  * Code & Diff Drawer with syntax preview, copy button, and SHA-256 hashes.
  * Checkpoint timeline and state transition audit logs.

### E. Database Migration
* **File:** `supabase/migrations/00012_create_work_continuity_engine.sql`
* Defines tables: `continuity_tasks`, `continuity_state_transitions`, `continuity_artifacts`, `continuity_checkpoints`, and `continuity_storage_budgets` with Row Level Security (RLS).

---

## 3. Step-by-Step Demo Walkthrough

### 🎬 Part 1: The Live Dashboard Overview (2 Minutes)
1. Open your browser and navigate to: **[http://localhost:3000/continuity](http://localhost:3000/continuity)**.
2. **Highlight the UI elements to the audience:**
   * **Application Storage Budget Gauge:** Shows the 50 MB configured budget, used bytes, and active status (`normal`).
   * **Tracked Tasks Column:** Shows active tasks such as `Stripe Webhook Handler` and `Build Distributed Queue`.
   * **Task Detail View:** Shows the objective, progress checklist, and current state badge (`in_progress`).
   * **Artifacts Tab:** Click on `src/webhooks/stripe.ts` to reveal the exact recoverable code preview and SHA-256 hash.
   * **Interactive Controls:** Demonstrate clicking **"Checkpoint"** or **"Export Handoff"** to copy the provider-neutral continuation package to your clipboard.

---

### 🎬 Part 2: Starting Work in ChatGPT (2 Minutes)
1. Open ChatGPT (connected to the SelfOS MCP server).
2. Type this prompt:
   ```text
   Call list-tasks to see what work is currently tracked in SelfOS Work Continuity.
   ```
3. ChatGPT will display the catalog of active tasks.
4. Now have ChatGPT start a new milestone:
   ```text
   Create a checkpoint for Stripe Webhook Handler called "signature-verification-complete" with next action "Wire database order updates in payment_intent.succeeded".
   ```
5. ChatGPT calls `create-checkpoint`. Switch back to the dashboard at [http://localhost:3000/continuity](http://localhost:3000/continuity) to show that the new checkpoint appeared live in the timeline!

---

### 🎬 Part 3: Seamless Cross-Agent Resumption in Cursor IDE (3 Minutes)
*(Simulating: The developer switches from ChatGPT to their IDE to finish the code.)*

1. Open Cursor IDE and press `Ctrl + L` to open the AI chat.
2. Prompt Cursor:
   ```text
   Call list-tasks to see my active SelfOS tasks, then call resume-task for "Stripe Webhook Handler". Show me what was already done and what I should implement next.
   ```
3. **What Cursor does:**
   * Calls `list-tasks` and identifies `Stripe Webhook Handler`.
   * Calls `resume-task` (without any authentication errors).
   * Restores `src/webhooks/stripe.ts` byte-for-byte.
   * Prints the completed steps:
     * `[x] Configure Stripe SDK and verify webhook secret header`
     * `[x] Scaffold webhook route and signature verification`
   * Identifies the exact next recommended action:
     * *"Implement event dispatcher for payment_intent.succeeded to update order state in database and notify customer."*
4. Instruct Cursor:
   ```text
   Continue implementing that step now and call save-artifact to update src/webhooks/stripe.ts.
   ```
5. Cursor writes the database fulfillment code and persists the new version (`v2`) into SelfOS!

---

### 🎬 Part 4: Automated Test Suite (1 Minute)
Run the automated verification suite directly from your terminal:
```powershell
node --import ./mcp-server-alpic/node_modules/tsx/dist/esm/index.mjs eval/test-continuity-engine.mjs
```
**Expected Output:**
```text
================================================================================
   SELFOS WORK CONTINUITY ENGINE — AUTOMATED TEST SUITE
================================================================================

TEST 1: Task creation sets state to in_progress and records initial transition ... ✅ PASSED
TEST 2: Secret credentials (API keys, JWTs) are redacted before storage ... ✅ PASSED
TEST 3: Partial code persists with SHA-256 hash and version 1 ... ✅ PASSED
TEST 4: Duplicate artifact requests reuse existing version without incrementing ... ✅ PASSED
TEST 5: Modified code creates new version (v2) and preserves parent version ... ✅ PASSED
TEST 6: Multiple files can be tracked in the same continuity task ... ✅ PASSED
TEST 7: Create checkpoint with completed steps, pending steps, and next action ... ✅ PASSED
TEST 8: Simulated interruption moves task to 'interrupted' state safely ... ✅ PASSED
TEST 9: State machine rejects invalid transitions (e.g. interrupted -> completed) ... ✅ PASSED
TEST 10: Cross-agent resume loads checkpoint, verifies hashes, and produces continuation package ... ✅ PASSED
TEST 11: Storage budget calculates usage and maintains normal status below quota ... ✅ PASSED
TEST 12: Unauthorized user cannot read other user's tasks or artifacts ... ✅ PASSED

================================================================================
RESULTS: 12 / 12 tests passed (100%)
================================================================================
```

---

## 4. Key Takeaways for the Demo Audience
1. **Zero Work Lost:** Partial files, checkpoints, and plans are stored in exact, recoverable form — not lossy summaries.
2. **Cross-Agent Interoperability:** Work started in ChatGPT can be resumed in Cursor IDE or any MCP client without repeating completed steps.
3. **Hard Operational Guardrails:** Secret redaction prevents credential leaks, and the 50 MB budget guard prevents runaway database bloat.
