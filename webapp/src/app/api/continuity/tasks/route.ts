import { createClient } from "@/lib/supabase/server";
import { getTasksForUser, getBudgetForUser, loadStore, saveStore, type ContinuityTask, type StateTransition } from "@/lib/continuity";
import { NextResponse } from "next/server";
import crypto from "node:crypto";

const DEFAULT_DEMO_USER_ID = "eb049ac8-5cee-4d7e-a1d4-0d4698030f76";

export async function GET() {
  let userId = DEFAULT_DEMO_USER_ID;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) userId = user.id;
  } catch {
    // fallback to demo user
  }

  const tasks = getTasksForUser(userId);
  const budget = getBudgetForUser(userId);

  return NextResponse.json({
    data: {
      tasks,
      budget,
      count: tasks.length,
    },
  });
}

export async function POST(request: Request) {
  let userId = DEFAULT_DEMO_USER_ID;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) userId = user.id;
  } catch {
    // fallback
  }

  const body = await request.json();
  const { title, objective, project_id, plan_steps, budget_bytes } = body;

  if (!title || !objective) {
    return NextResponse.json({ error: "Title and objective are required" }, { status: 400 });
  }

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  const steps = (plan_steps ?? []).map((desc: string, i: number) => ({
    id: `step-${i + 1}`,
    description: desc,
    status: i === 0 ? "in_progress" : "pending",
  }));

  const task: ContinuityTask = {
    id: taskId,
    project_id: project_id || "default",
    user_id: userId,
    title,
    objective,
    plan: { steps },
    current_state: "in_progress",
    source_platform: "dashboard",
    source_agent: "twin",
    budget_bytes: budget_bytes || 52428800,
    used_bytes: 0,
    created_at: now,
    updated_at: now,
  };

  const transition: StateTransition = {
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    from_state: "queued",
    to_state: "in_progress",
    trigger: "dashboard_task_created",
    platform: "dashboard",
    agent: "twin",
    created_at: now,
  };

  const store = loadStore();
  store.tasks[taskId] = task;
  store.transitions.push(transition);
  saveStore(store);

  return NextResponse.json({ data: task }, { status: 201 });
}
