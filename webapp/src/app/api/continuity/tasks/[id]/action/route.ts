import { createClient } from "@/lib/supabase/server";
import { loadStore, saveStore, getTaskDetail, type StateTransition, type ContinuityCheckpoint } from "@/lib/continuity";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

const DEFAULT_DEMO_USER_ID = "eb049ac8-5cee-4d7e-a1d4-0d4698030f76";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId = DEFAULT_DEMO_USER_ID;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) userId = user.id;
  } catch {
    // fallback
  }

  const { id: taskId } = await params;
  const body = await request.json();
  const { action, payload } = body;

  const store = loadStore();
  const task = store.tasks[taskId];

  if (!task || task.user_id !== userId) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (action === "pause") {
    const cpId = crypto.randomUUID();
    const cp: ContinuityCheckpoint = {
      id: cpId,
      task_id: taskId,
      user_id: userId,
      name: `pause-${Date.now()}`,
      summary: payload?.reason || "Task paused via Dashboard",
      completed_steps: [],
      pending_steps: [],
      next_recommended_action: payload?.next_action || "Resume task when ready to continue.",
      artifact_snapshots: store.artifacts
        .filter((a) => a.task_id === taskId)
        .map((a) => ({
          path: a.path,
          version: a.version,
          content_hash: a.content_hash,
          size_bytes: a.size_bytes,
          status: a.status,
        })),
      created_at: now,
    };
    store.checkpoints.push(cp);

    const prev = task.current_state;
    task.current_state = "paused";
    task.latest_checkpoint_id = cpId;
    task.updated_at = now;

    const transition: StateTransition = {
      id: crypto.randomUUID(),
      task_id: taskId,
      user_id: userId,
      from_state: prev,
      to_state: "paused",
      trigger: "dashboard_pause",
      checkpoint_id: cpId,
      created_at: now,
    };
    store.transitions.push(transition);
    saveStore(store);

    return NextResponse.json({ success: true, task, checkpoint: cp });
  }

  if (action === "resume") {
    const prev = task.current_state;
    task.current_state = "in_progress";
    task.updated_at = now;

    const transition: StateTransition = {
      id: crypto.randomUUID(),
      task_id: taskId,
      user_id: userId,
      from_state: prev,
      to_state: "in_progress",
      trigger: "dashboard_resume",
      agent: payload?.receiving_agent || "twin",
      platform: "dashboard",
      created_at: now,
    };
    store.transitions.push(transition);
    saveStore(store);

    return NextResponse.json({ success: true, task });
  }

  if (action === "checkpoint") {
    const cpId = crypto.randomUUID();
    const cp: ContinuityCheckpoint = {
      id: cpId,
      task_id: taskId,
      user_id: userId,
      name: payload?.name || `checkpoint-${Date.now()}`,
      summary: payload?.summary || "Manual checkpoint created from dashboard",
      completed_steps: (payload?.completed_steps || []).map((s: string, i: number) => ({ id: `c-${i + 1}`, description: s, status: "completed" })),
      pending_steps: (payload?.pending_steps || []).map((s: string, i: number) => ({ id: `p-${i + 1}`, description: s, status: "pending" })),
      next_recommended_action: payload?.next_action || "Continue with next pending step.",
      artifact_snapshots: store.artifacts
        .filter((a) => a.task_id === taskId)
        .map((a) => ({
          path: a.path,
          version: a.version,
          content_hash: a.content_hash,
          size_bytes: a.size_bytes,
          status: a.status,
        })),
      created_at: now,
    };
    store.checkpoints.push(cp);
    task.latest_checkpoint_id = cpId;
    task.updated_at = now;

    const transition: StateTransition = {
      id: crypto.randomUUID(),
      task_id: taskId,
      user_id: userId,
      from_state: task.current_state,
      to_state: task.current_state,
      trigger: "dashboard_manual_checkpoint",
      checkpoint_id: cpId,
      created_at: now,
    };
    store.transitions.push(transition);
    saveStore(store);

    return NextResponse.json({ success: true, checkpoint: cp });
  }

  if (action === "validate") {
    const prev = task.current_state;
    task.current_state = "completed";
    task.updated_at = now;

    const transition: StateTransition = {
      id: crypto.randomUUID(),
      task_id: taskId,
      user_id: userId,
      from_state: prev,
      to_state: "completed",
      trigger: "dashboard_validation_passed",
      created_at: now,
    };
    store.transitions.push(transition);
    saveStore(store);

    return NextResponse.json({ success: true, task });
  }

  if (action === "export_handoff") {
    const detail = getTaskDetail(userId, taskId);
    return NextResponse.json({
      handoff_format: "selfos-continuity-v1",
      exported_at: now,
      data: detail,
    });
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
