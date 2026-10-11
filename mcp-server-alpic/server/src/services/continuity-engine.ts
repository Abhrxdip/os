import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../../data/continuity");

// Ensure local persistence directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const BLOBS_DIR = path.join(DATA_DIR, "blobs");
if (!fs.existsSync(BLOBS_DIR)) {
  fs.mkdirSync(BLOBS_DIR, { recursive: true });
}

// ============================================================================
// Types
// ============================================================================
export type TaskState =
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

export type ArtifactStatus =
  | "planned"
  | "partially_generated"
  | "persisted"
  | "applied"
  | "validated"
  | "completed";

export type StorageStatus = "normal" | "warning" | "critical" | "exhausted";

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
  current_state: TaskState;
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
  from_state: TaskState;
  to_state: TaskState;
  trigger: string;
  platform?: string;
  agent?: string;
  session_id?: string;
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
  status: ArtifactStatus;
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
    status: ArtifactStatus;
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
  status: StorageStatus;
  warning_threshold_percent: number;
  critical_threshold_percent: number;
  exhausted_threshold_percent: number;
}

export interface ContinuationPackage {
  task: ContinuityTask;
  checkpoint: ContinuityCheckpoint;
  artifacts: ContinuityArtifact[];
  instructions_for_receiving_agent: string;
  handoff_summary: string;
}

// ============================================================================
// Valid State Transitions Map
// ============================================================================
const VALID_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  queued: ["in_progress", "cancelled"],
  in_progress: [
    "checkpointing",
    "paused",
    "interrupted",
    "waiting_for_agent",
    "resuming",
    "validating",
    "failed",
    "cancelled",
  ],
  checkpointing: [
    "in_progress",
    "paused",
    "interrupted",
    "waiting_for_agent",
    "validating",
    "failed",
  ],
  paused: ["resuming", "cancelled"],
  interrupted: ["resuming", "waiting_for_agent", "failed", "cancelled"],
  waiting_for_agent: ["resuming", "cancelled"],
  resuming: ["in_progress", "validating", "failed"],
  validating: ["completed", "in_progress", "failed"],
  completed: ["resuming"], // Can resume for follow-up work
  failed: ["resuming", "cancelled"],
  cancelled: [],
};

// ============================================================================
// Secret Redaction Helper
// ============================================================================
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI / Anthropic keys
  /ghp_[a-zA-Z0-9]{30,}/g, // GitHub tokens
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, // JWTs
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[^-]+-----END [A-Z ]+ PRIVATE KEY-----/g,
  /(password|passwd|api[_-]?key|secret)\s*[:=]\s*["']([^"']+)["']/gi,
];

export function redactSecrets(content: string): string {
  let redacted = content;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, p1) => {
      if (p1) {
        return `${p1}="[REDACTED_SECRET]"`;
      }
      return "[REDACTED_SECRET]";
    });
  }
  return redacted;
}

// ============================================================================
// Local Store Database File
// ============================================================================
interface LocalStoreSchema {
  tasks: Record<string, ContinuityTask>;
  transitions: StateTransition[];
  artifacts: ContinuityArtifact[];
  checkpoints: ContinuityCheckpoint[];
  budgets: Record<string, StorageBudgetInfo>;
}

const STORE_FILE = path.join(DATA_DIR, "continuity_store.json");

function loadStore(): LocalStoreSchema {
  if (!fs.existsSync(STORE_FILE)) {
    const initial: LocalStoreSchema = {
      tasks: {},
      transitions: [],
      artifacts: [],
      checkpoints: [],
      budgets: {},
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    return JSON.parse(raw) as LocalStoreSchema;
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

function saveStore(store: LocalStoreSchema): void {
  const tempPath = `${STORE_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tempPath, STORE_FILE);
}

// ============================================================================
// Storage Budget Enforcer
// ============================================================================
export function getStorageBudget(userId: string): StorageBudgetInfo {
  const store = loadStore();
  const existing = store.budgets[userId];
  if (existing) {
    return existing;
  }

  // Calculate actual storage used by user
  let used = 0;
  for (const art of store.artifacts) {
    if (art.user_id === userId) {
      used += art.size_bytes;
    }
  }

  const allocated = 52428800; // 50 MB default
  const percent = Math.round((used / allocated) * 100);
  let status: StorageStatus = "normal";
  if (percent >= 95) status = "exhausted";
  else if (percent >= 85) status = "critical";
  else if (percent >= 70) status = "warning";

  const budget: StorageBudgetInfo = {
    user_id: userId,
    allocated_bytes: allocated,
    used_bytes: used,
    percent_used: percent,
    status,
    warning_threshold_percent: 70,
    critical_threshold_percent: 85,
    exhausted_threshold_percent: 95,
  };

  store.budgets[userId] = budget;
  saveStore(store);
  return budget;
}

function updateStorageUsage(userId: string, addedBytes: number): StorageBudgetInfo {
  const store = loadStore();
  const budget = getStorageBudget(userId);
  budget.used_bytes = Math.max(0, budget.used_bytes + addedBytes);
  budget.percent_used = Math.round((budget.used_bytes / budget.allocated_bytes) * 100);

  if (budget.percent_used >= budget.exhausted_threshold_percent) {
    budget.status = "exhausted";
  } else if (budget.percent_used >= budget.critical_threshold_percent) {
    budget.status = "critical";
  } else if (budget.percent_used >= budget.warning_threshold_percent) {
    budget.status = "warning";
  } else {
    budget.status = "normal";
  }

  store.budgets[userId] = budget;
  saveStore(store);
  return budget;
}

// ============================================================================
// Core Task Management
// ============================================================================
export async function createContinuityTask(
  supabase: SupabaseClient | null,
  userId: string,
  params: {
    title: string;
    objective: string;
    projectId?: string;
    planSteps?: string[];
    sourcePlatform?: string;
    sourceAgent?: string;
    budgetBytes?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<ContinuityTask> {
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();

  const steps: PlanStep[] = (params.planSteps ?? []).map((desc, idx) => ({
    id: `step-${idx + 1}`,
    description: desc,
    status: idx === 0 ? "in_progress" : "pending",
  }));

  const task: ContinuityTask = {
    id: taskId,
    project_id: params.projectId || "default",
    user_id: userId,
    title: params.title,
    objective: params.objective,
    plan: { steps },
    current_state: "in_progress",
    source_platform: params.sourcePlatform || "chatgpt",
    source_agent: params.sourceAgent || "twin",
    budget_bytes: params.budgetBytes || 52428800,
    used_bytes: 0,
    metadata: params.metadata || {},
    created_at: now,
    updated_at: now,
  };

  // Record initial transition
  const transition: StateTransition = {
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    from_state: "queued",
    to_state: "in_progress",
    trigger: "task_created",
    platform: task.source_platform,
    agent: task.source_agent,
    created_at: now,
  };

  // Save to local store
  const store = loadStore();
  store.tasks[taskId] = task;
  store.transitions.push(transition);
  saveStore(store);

  // Attempt Supabase write if available
  if (supabase) {
    try {
      await supabase.from("continuity_tasks").insert({
        id: task.id,
        project_id: task.project_id,
        user_id: task.user_id,
        title: task.title,
        objective: task.objective,
        plan: task.plan,
        current_state: task.current_state,
        source_platform: task.source_platform,
        source_agent: task.source_agent,
        budget_bytes: task.budget_bytes,
        used_bytes: task.used_bytes,
        metadata: task.metadata,
      });
      await supabase.from("continuity_state_transitions").insert(transition);
    } catch (e) {
      console.warn("[ContinuityEngine] Supabase write skipped, durable local store active:", e);
    }
  }

  return task;
}

export async function updateTaskState(
  supabase: SupabaseClient | null,
  userId: string,
  taskId: string,
  newState: TaskState,
  params: {
    trigger: string;
    platform?: string;
    agent?: string;
    checkpointId?: string;
    errorDetails?: Record<string, unknown>;
  }
): Promise<{ task: ContinuityTask; transition: StateTransition }> {
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) {
    throw new Error(`Task with ID "${taskId}" not found.`);
  }

  if (task.user_id !== userId) {
    throw new Error("Unauthorized: Access denied to task.");
  }

  const currentState = task.current_state;

  // Validate State Transition
  const allowed = VALID_TRANSITIONS[currentState] ?? [];
  if (!allowed.includes(newState) && currentState !== newState) {
    throw new Error(
      `Invalid state transition: Cannot transition from "${currentState}" to "${newState}". Allowed next states: [${allowed.join(", ")}]`
    );
  }

  const now = new Date().toISOString();
  task.current_state = newState;
  task.updated_at = now;
  if (params.checkpointId) {
    task.latest_checkpoint_id = params.checkpointId;
  }

  const transition: StateTransition = {
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    from_state: currentState,
    to_state: newState,
    trigger: params.trigger,
    platform: params.platform || task.source_platform,
    agent: params.agent || task.source_agent,
    checkpoint_id: params.checkpointId,
    error_details: params.errorDetails,
    created_at: now,
  };

  store.tasks[taskId] = task;
  store.transitions.push(transition);
  saveStore(store);

  if (supabase) {
    try {
      await supabase
        .from("continuity_tasks")
        .update({
          current_state: newState,
          latest_checkpoint_id: task.latest_checkpoint_id,
          updated_at: now,
        })
        .eq("id", taskId)
        .eq("user_id", userId);

      await supabase.from("continuity_state_transitions").insert(transition);
    } catch (e) {
      console.warn("[ContinuityEngine] Supabase transition update skipped:", e);
    }
  }

  return { task, transition };
}

// ============================================================================
// Artifact Persistence with Content-Addressing & Secret Redaction
// ============================================================================
export async function saveArtifact(
  supabase: SupabaseClient | null,
  userId: string,
  taskId: string,
  params: {
    path: string;
    content: string;
    status: ArtifactStatus;
    diff?: string;
    sourcePlatform?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ContinuityArtifact> {
  const budget = getStorageBudget(userId);
  if (budget.status === "exhausted") {
    throw new Error(
      `Storage budget exhausted (${budget.percent_used}% used). Cannot save new artifacts. Clean up old artifacts or expand budget.`
    );
  }

  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) {
    throw new Error(`Task with ID "${taskId}" not found.`);
  }

  // Redact any secrets before storing
  const safeContent = redactSecrets(params.content);
  const safeDiff = params.diff ? redactSecrets(params.diff) : undefined;

  // Compute SHA-256 hash
  const contentHash = crypto.createHash("sha256").update(safeContent).digest("hex");
  const sizeBytes = Buffer.byteLength(safeContent, "utf-8");

  // Check previous versions of this file path for this task
  const existingVersions = store.artifacts
    .filter((a) => a.task_id === taskId && a.path === params.path)
    .sort((a, b) => b.version - a.version);

  const latestVersion = existingVersions[0];

  // Idempotency check: If content is identical to latest version, do not duplicate
  if (latestVersion && latestVersion.content_hash === contentHash && latestVersion.status === params.status) {
    return latestVersion;
  }

  const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;
  const parentVersion = latestVersion ? latestVersion.version : undefined;

  // Save blob to content-addressed storage
  const blobPath = path.join(BLOBS_DIR, `${contentHash}.txt`);
  if (!fs.existsSync(blobPath)) {
    fs.writeFileSync(blobPath, safeContent, "utf-8");
  }

  const artifactId = crypto.randomUUID();
  const now = new Date().toISOString();

  const artifact: ContinuityArtifact = {
    id: artifactId,
    task_id: taskId,
    user_id: userId,
    path: params.path,
    version: newVersionNumber,
    content_hash: contentHash,
    content: safeContent,
    diff: safeDiff,
    status: params.status,
    size_bytes: sizeBytes,
    parent_version: parentVersion,
    source_platform: params.sourcePlatform || task.source_platform,
    metadata: params.metadata || {},
    created_at: now,
  };

  store.artifacts.push(artifact);
  task.used_bytes += sizeBytes;
  task.updated_at = now;
  store.tasks[taskId] = task;
  saveStore(store);

  updateStorageUsage(userId, sizeBytes);

  if (supabase) {
    try {
      await supabase.from("continuity_artifacts").insert(artifact);
      await supabase
        .from("continuity_tasks")
        .update({ used_bytes: task.used_bytes, updated_at: now })
        .eq("id", taskId);
    } catch (e) {
      console.warn("[ContinuityEngine] Supabase artifact insert skipped:", e);
    }
  }

  return artifact;
}

export function getArtifact(
  userId: string,
  taskId: string,
  filePath: string,
  version?: number
): ContinuityArtifact | null {
  const store = loadStore();
  const matches = store.artifacts.filter(
    (a) => a.task_id === taskId && a.user_id === userId && a.path === filePath
  );

  if (matches.length === 0) return null;

  if (version !== undefined) {
    return matches.find((a) => a.version === version) ?? null;
  }

  // Return latest version
  return matches.sort((a, b) => b.version - a.version)[0];
}

export function listTaskArtifacts(userId: string, taskId: string): ContinuityArtifact[] {
  const store = loadStore();
  return store.artifacts.filter((a) => a.task_id === taskId && a.user_id === userId);
}

// ============================================================================
// Checkpoint & Resume Engine
// ============================================================================
export async function createCheckpoint(
  supabase: SupabaseClient | null,
  userId: string,
  taskId: string,
  params: {
    name: string;
    summary: string;
    completedSteps: Array<{ id: string; description: string; status: "completed" }>;
    pendingSteps: Array<{ id: string; description: string; status: "pending" | "in_progress" }>;
    nextRecommendedAction: string;
    gitRef?: string;
    errors?: string[];
    dependencies?: string[];
  }
): Promise<ContinuityCheckpoint> {
  const store = loadStore();
  const task = store.tasks[taskId];
  if (!task) {
    throw new Error(`Task with ID "${taskId}" not found.`);
  }

  // Gather current latest versions of all artifacts for this task
  const taskArtifacts = listTaskArtifacts(userId, taskId);
  const byPath = new Map<string, ContinuityArtifact>();
  for (const art of taskArtifacts) {
    const prev = byPath.get(art.path);
    if (!prev || art.version > prev.version) {
      byPath.set(art.path, art);
    }
  }

  const snapshots = Array.from(byPath.values()).map((a) => ({
    path: a.path,
    version: a.version,
    content_hash: a.content_hash,
    size_bytes: a.size_bytes,
    status: a.status,
  }));

  const checkpointId = crypto.randomUUID();
  const now = new Date().toISOString();

  const checkpoint: ContinuityCheckpoint = {
    id: checkpointId,
    task_id: taskId,
    user_id: userId,
    name: params.name,
    summary: params.summary,
    completed_steps: params.completedSteps,
    pending_steps: params.pendingSteps,
    next_recommended_action: params.nextRecommendedAction,
    artifact_snapshots: snapshots,
    git_ref: params.gitRef,
    errors: params.errors || [],
    dependencies: params.dependencies || [],
    created_at: now,
  };

  store.checkpoints.push(checkpoint);
  task.latest_checkpoint_id = checkpointId;
  task.updated_at = now;
  store.tasks[taskId] = task;
  saveStore(store);

  // Transition state to checkpointing -> in_progress or paused
  const transition: StateTransition = {
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    from_state: task.current_state,
    to_state: "checkpointing",
    trigger: "create_checkpoint",
    checkpoint_id: checkpointId,
    created_at: now,
  };
  store.transitions.push(transition);
  saveStore(store);

  if (supabase) {
    try {
      await supabase.from("continuity_checkpoints").insert(checkpoint);
      await supabase
        .from("continuity_tasks")
        .update({ latest_checkpoint_id: checkpointId, updated_at: now })
        .eq("id", taskId);
      await supabase.from("continuity_state_transitions").insert(transition);
    } catch (e) {
      console.warn("[ContinuityEngine] Supabase checkpoint insert skipped:", e);
    }
  }

  return checkpoint;
}

export function getCheckpoint(userId: string, checkpointId: string): ContinuityCheckpoint | null {
  const store = loadStore();
  return store.checkpoints.find((c) => c.id === checkpointId && c.user_id === userId) ?? null;
}

export function listCheckpoints(userId: string, taskId: string): ContinuityCheckpoint[] {
  const store = loadStore();
  return store.checkpoints
    .filter((c) => c.task_id === taskId && c.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Resume Task & Generate Provider-Neutral Continuation Package
 */
export async function resumeTask(
  supabase: SupabaseClient | null,
  userId: string,
  taskId: string,
  params?: {
    receivingAgent?: string;
    receivingPlatform?: string;
  }
): Promise<ContinuationPackage> {
  const task = findTask(userId, taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" not found.`);
  }
  const resolvedTaskId = task.id;

  // Find latest checkpoint
  const checkpoints = listCheckpoints(userId, resolvedTaskId);
  const latestCheckpoint = checkpoints[0];
  if (!latestCheckpoint) {
    throw new Error(`Cannot resume task "${task.title}": No saved checkpoints found.`);
  }

  // Load all latest artifacts associated with this checkpoint
  const latestArtifacts: ContinuityArtifact[] = [];
  for (const snap of latestCheckpoint.artifact_snapshots) {
    const art = getArtifact(userId, resolvedTaskId, snap.path, snap.version);
    if (art) {
      latestArtifacts.push(art);
    }
  }

  // Update task state: interrupted/paused/failed -> resuming -> in_progress
  await updateTaskState(supabase, userId, resolvedTaskId, "resuming", {
    trigger: "resume_task_requested",
    agent: params?.receivingAgent,
    platform: params?.receivingPlatform,
    checkpointId: latestCheckpoint.id,
  });

  await updateTaskState(supabase, userId, resolvedTaskId, "in_progress", {
    trigger: "continuation_package_delivered",
    agent: params?.receivingAgent,
    platform: params?.receivingPlatform,
    checkpointId: latestCheckpoint.id,
  });

  const receivingAgent = params?.receivingAgent || "Authorized AI Agent";
  const instructions = `
# CONTINUATION INSTRUCTIONS FOR: ${receivingAgent}
You are resuming an active SelfOS engineering task without restarting from scratch.

## 🎯 Task Objective
${task.objective}

## 📍 Current State & Latest Checkpoint
- Checkpoint Name: "${latestCheckpoint.name}"
- Summary: ${latestCheckpoint.summary}
- Next Recommended Action: ${latestCheckpoint.next_recommended_action}

## ✅ Completed Steps (DO NOT REDO)
${latestCheckpoint.completed_steps.map((s) => `- [x] ${s.description}`).join("\n") || "None"}

## ⏳ Pending Work To Complete
${latestCheckpoint.pending_steps.map((s) => `- [ ] ${s.description}`).join("\n") || "All steps completed"}

## 📁 Active Files & Saved Artifacts (${latestArtifacts.length})
${latestArtifacts
  .map(
    (a) =>
      `### File: \`${a.path}\` (v${a.version}, status: ${a.status}, sha256: ${a.content_hash.slice(0, 8)}...)\n\`\`\`\n${a.content.slice(0, 1000)}${a.content.length > 1000 ? "\n...[truncated preview]" : ""}\n\`\`\``
  )
  .join("\n\n")}

## ⚠️ Important Continuity Rules
1. Do NOT regenerate or re-write code that is already marked as completed or validated.
2. Continue directly from: "${latestCheckpoint.next_recommended_action}".
3. Save incremental progress using \`save-artifact\` and update state with \`create-checkpoint\`.
`.trim();

  const handoffSummary = `Resumed task "${task.title}". Checkpoint "${latestCheckpoint.name}" restored with ${latestArtifacts.length} artifact(s). Next action: ${latestCheckpoint.next_recommended_action}`;

  const updatedTask = getTaskById(userId, resolvedTaskId) || task;

  return {
    task: updatedTask,
    checkpoint: latestCheckpoint,
    artifacts: latestArtifacts,
    instructions_for_receiving_agent: instructions,
    handoff_summary: handoffSummary,
  };
}

export function getAllTasks(userId: string): ContinuityTask[] {
  const store = loadStore();
  return Object.values(store.tasks)
    .filter((t) => t.user_id === userId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export function findTask(userId: string, idOrQuery: string): ContinuityTask | null {
  const store = loadStore();
  if (store.tasks[idOrQuery] && store.tasks[idOrQuery].user_id === userId) {
    return store.tasks[idOrQuery];
  }
  const userTasks = Object.values(store.tasks).filter((t) => t.user_id === userId);
  const q = idOrQuery.toLowerCase().trim();
  const match = userTasks.find(
    (t) =>
      t.id.toLowerCase() === q ||
      t.title.toLowerCase() === q ||
      t.title.toLowerCase().includes(q) ||
      t.objective.toLowerCase().includes(q)
  );
  return match || null;
}

export function getTaskById(userId: string, taskId: string): ContinuityTask | null {
  return findTask(userId, taskId);
}

export function getTaskTransitions(userId: string, taskId: string): StateTransition[] {
  const store = loadStore();
  const task = findTask(userId, taskId);
  const resolvedId = task ? task.id : taskId;
  return store.transitions
    .filter((t) => t.task_id === resolvedId && t.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
