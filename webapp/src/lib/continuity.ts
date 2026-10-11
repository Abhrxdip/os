import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface PlanStep {
  readonly id: string;
  readonly description: string;
  readonly status: "pending" | "in_progress" | "completed" | "failed";
  readonly assigned_agent?: string;
}

export interface ContinuityTask {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  objective: string;
  plan: {
    steps: PlanStep[];
    [key: string]: unknown;
  };
  current_state:
    | "queued"
    | "in_progress"
    | "checkpointing"
    | "paused"
    | "interrupted"
    | "waiting_for_agent"
    | "resuming"
    | "validating"
    | "completed"
    | "failed"
    | "cancelled";
  source_platform: string;
  source_agent: string;
  session_id?: string;
  latest_checkpoint_id?: string;
  budget_bytes: number;
  used_bytes: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StateTransition {
  id: string;
  task_id: string;
  user_id: string;
  from_state: string;
  to_state: string;
  trigger: string;
  platform?: string;
  agent?: string;
  checkpoint_id?: string;
  error_details?: Record<string, unknown>;
  created_at: string;
}

export interface ContinuityArtifact {
  id: string;
  task_id: string;
  user_id: string;
  path: string;
  version: number;
  content_hash: string;
  content: string;
  diff?: string;
  status:
    | "planned"
    | "partially_generated"
    | "persisted"
    | "applied"
    | "validated"
    | "completed";
  size_bytes: number;
  parent_version?: number;
  source_platform?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ContinuityCheckpoint {
  id: string;
  task_id: string;
  user_id: string;
  name: string;
  summary: string;
  completed_steps: PlanStep[];
  pending_steps: PlanStep[];
  next_recommended_action: string;
  artifact_snapshots: Array<{
    path: string;
    version: number;
    content_hash: string;
    size_bytes: number;
    status: string;
  }>;
  git_ref?: string;
  errors?: string[];
  dependencies?: string[];
  created_at: string;
}

export interface StorageBudgetInfo {
  user_id: string;
  allocated_bytes: number;
  used_bytes: number;
  percent_used: number;
  status: "normal" | "warning" | "critical" | "exhausted";
  warning_threshold_percent: number;
  critical_threshold_percent: number;
  exhausted_threshold_percent: number;
}

interface LocalStoreSchema {
  tasks: Record<string, ContinuityTask>;
  transitions: StateTransition[];
  artifacts: ContinuityArtifact[];
  checkpoints: ContinuityCheckpoint[];
  budgets: Record<string, StorageBudgetInfo>;
}

function getDataDir(): string {
  // Check candidate paths for mcp-server-alpic/data/continuity
  const candidates = [
    path.resolve(process.cwd(), "../mcp-server-alpic/data/continuity"),
    path.resolve(process.cwd(), "data/continuity"),
    "C:\\Users\\abhra\\OneDrive\\Desktop\\DigitalTwin\\mcp-server-alpic\\data\\continuity",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const fallback = candidates[0];
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function getStoreFile(): string {
  return path.join(getDataDir(), "continuity_store.json");
}

export function loadStore(): LocalStoreSchema {
  const file = getStoreFile();
  if (!fs.existsSync(file)) {
    return {
      tasks: {},
      transitions: [],
      artifacts: [],
      checkpoints: [],
      budgets: {},
    };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as LocalStoreSchema;
  } catch {
    return {
      tasks: {},
      transitions: [],
      artifacts: [],
      checkpoints: [],
      budgets: {},
    };
  }
}

export function saveStore(store: LocalStoreSchema): void {
  const file = getStoreFile();
  const temp = `${file}.tmp.${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(temp, file);
}

export function getTasksForUser(userId: string): ContinuityTask[] {
  const store = loadStore();
  return Object.values(store.tasks)
    .filter((t) => t.user_id === userId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export function getTaskDetail(userId: string, taskId: string) {
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task || task.user_id !== userId) return null;

  const artifacts = store.artifacts
    .filter((a) => a.task_id === taskId && a.user_id === userId)
    .sort((a, b) => b.version - a.version);

  const checkpoints = store.checkpoints
    .filter((c) => c.task_id === taskId && c.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const transitions = store.transitions
    .filter((t) => t.task_id === taskId && t.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    task,
    artifacts,
    checkpoints,
    transitions,
  };
}

export function getBudgetForUser(userId: string): StorageBudgetInfo {
  const store = loadStore();
  const existing = store.budgets[userId];
  if (existing) return existing;

  let used = 0;
  for (const art of store.artifacts) {
    if (art.user_id === userId) used += art.size_bytes;
  }
  const allocated = 52428800; // 50 MB
  const percent = Math.round((used / allocated) * 100);
  let status: "normal" | "warning" | "critical" | "exhausted" = "normal";
  if (percent >= 95) status = "exhausted";
  else if (percent >= 85) status = "critical";
  else if (percent >= 70) status = "warning";

  return {
    user_id: userId,
    allocated_bytes: allocated,
    used_bytes: used,
    percent_used: percent,
    status,
    warning_threshold_percent: 70,
    critical_threshold_percent: 85,
    exhausted_threshold_percent: 95,
  };
}
