import assert from "node:assert";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the compiled continuity engine
const enginePath = path.resolve(__dirname, "../mcp-server-alpic/server/src/services/continuity-engine.ts");
const {
  createContinuityTask,
  updateTaskState,
  saveArtifact,
  getArtifact,
  listTaskArtifacts,
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  resumeTask,
  getTaskById,
  getTaskTransitions,
  getStorageBudget,
  redactSecrets,
} = await import(pathToFileURL(enginePath).href);

console.log("================================================================================");
console.log("   SELFOS WORK CONTINUITY ENGINE — AUTOMATED TEST SUITE");
console.log("================================================================================\n");

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  process.stdout.write(`TEST ${total}: ${name} ... `);
  try {
    await fn();
    console.log("✅ PASSED");
    passed++;
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
    console.error(err);
  }
}

const testUserId = "eb049ac8-5cee-4d7e-a1d4-0d4698030f76";
const unauthorizedUserId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// 1. Task Creation & Initial State
let taskId = "";
await test("Task creation sets state to in_progress and records initial transition", async () => {
  const task = await createContinuityTask(null, testUserId, {
    title: "Build Distributed Queue",
    objective: "Implement an idempotent distributed queue in TypeScript with ACK/NACK.",
    planSteps: ["Define message interface", "Implement queue broker", "Add persistence", "Write unit tests"],
    sourcePlatform: "chatgpt",
  });
  assert.ok(task.id, "Task should have an ID");
  assert.strictEqual(task.current_state, "in_progress");
  assert.strictEqual(task.plan.steps.length, 4);

  taskId = task.id;
  const transitions = getTaskTransitions(testUserId, taskId);
  assert.strictEqual(transitions.length, 1);
  assert.strictEqual(transitions[0].from_state, "queued");
  assert.strictEqual(transitions[0].to_state, "in_progress");
});

// 2. Secret Redaction
await test("Secret credentials (API keys, JWTs) are redacted before storage", async () => {
  const sensitiveContent = `const apiKey = "sk-proj-1234567890abcdef1234567890";
const githubToken = "ghp_abcdefghijklmnopqrstuvwxyz123456";
export function connect() { return true; }`;
  const redacted = redactSecrets(sensitiveContent);
  assert.ok(!redacted.includes("sk-proj-"), "OpenAI key must be redacted");
  assert.ok(!redacted.includes("ghp_"), "GitHub token must be redacted");
  assert.ok(redacted.includes("[REDACTED_SECRET]"));
});

// 3. Partial Code Persistence with SHA-256
let art1Hash = "";
await test("Partial code persists with SHA-256 hash and version 1", async () => {
  const art = await saveArtifact(null, testUserId, taskId, {
    path: "src/queue/broker.ts",
    content: "export class MessageBroker { private items: any[] = []; }",
    status: "partially_generated",
  });
  assert.strictEqual(art.path, "src/queue/broker.ts");
  assert.strictEqual(art.version, 1);
  assert.strictEqual(art.status, "partially_generated");
  assert.ok(art.content_hash);
  art1Hash = art.content_hash;
});

// 4. Duplicate Request Deduplication (Idempotency)
await test("Duplicate artifact requests reuse existing version without incrementing", async () => {
  const dup = await saveArtifact(null, testUserId, taskId, {
    path: "src/queue/broker.ts",
    content: "export class MessageBroker { private items: any[] = []; }",
    status: "partially_generated",
  });
  assert.strictEqual(dup.version, 1, "Version should remain 1 for identical content");
  assert.strictEqual(dup.content_hash, art1Hash);
});

// 5. Version Increment on File Modification
await test("Modified code creates new version (v2) and preserves parent version", async () => {
  const v2 = await saveArtifact(null, testUserId, taskId, {
    path: "src/queue/broker.ts",
    content: "export class MessageBroker {\n  private items: any[] = [];\n  publish(msg: any) { this.items.push(msg); }\n}",
    status: "persisted",
    diff: "+  publish(msg: any) { this.items.push(msg); }",
  });
  assert.strictEqual(v2.version, 2);
  assert.strictEqual(v2.parent_version, 1);
  assert.notStrictEqual(v2.content_hash, art1Hash);
});

// 6. Multiple Files Saved Consistently
await test("Multiple files can be tracked in the same continuity task", async () => {
  const typesArt = await saveArtifact(null, testUserId, taskId, {
    path: "src/queue/types.ts",
    content: "export interface Message { id: string; payload: unknown; }",
    status: "completed",
  });
  assert.strictEqual(typesArt.version, 1);
  const allArts = listTaskArtifacts(testUserId, taskId);
  assert.strictEqual(allArts.length, 3); // broker v1, broker v2, types v1
});

// 7. Checkpoint Creation
let checkpointId = "";
await test("Create checkpoint with completed steps, pending steps, and next action", async () => {
  const cp = await createCheckpoint(null, testUserId, taskId, {
    name: "broker-core-implemented",
    summary: "Broker core class created with publish method and message interface.",
    completedSteps: [
      { id: "step-1", description: "Define message interface", status: "completed" },
      { id: "step-2", description: "Implement queue broker", status: "completed" },
    ],
    pendingSteps: [
      { id: "step-3", description: "Add persistence", status: "pending" },
      { id: "step-4", description: "Write unit tests", status: "pending" },
    ],
    nextRecommendedAction: "Implement queue persistence layer using SQLite or file buffer.",
    gitRef: "commit-49f2b1a",
  });
  assert.ok(cp.id);
  assert.strictEqual(cp.completed_steps.length, 2);
  assert.strictEqual(cp.pending_steps.length, 2);
  assert.strictEqual(cp.artifact_snapshots.length, 2); // latest broker v2 and types v1
  checkpointId = cp.id;
});

// 8. Simulated Interruption
await test("Simulated interruption moves task to 'interrupted' state safely", async () => {
  const { task, transition } = await updateTaskState(null, testUserId, taskId, "interrupted", {
    trigger: "network_timeout_or_token_limit",
    platform: "chatgpt",
  });
  assert.strictEqual(task.current_state, "interrupted");
  assert.strictEqual(transition.to_state, "interrupted");
});

// 9. State Transition Validation: Reject Invalid Transitions
await test("State machine rejects invalid transitions (e.g. interrupted -> completed)", async () => {
  let threw = false;
  try {
    await updateTaskState(null, testUserId, taskId, "completed", {
      trigger: "illegal_skip",
    });
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes("Invalid state transition"));
  }
  assert.strictEqual(threw, true, "Should reject illegal state transition");
});

// 10. Cross-Agent Resume (e.g. Cursor IDE takes over from ChatGPT)
await test("Cross-agent resume loads checkpoint, verifies hashes, and produces continuation package", async () => {
  const pkg = await resumeTask(null, testUserId, taskId, {
    receivingAgent: "Cursor IDE",
    receivingPlatform: "ide",
  });

  assert.strictEqual(pkg.task.id, taskId);
  assert.strictEqual(pkg.task.current_state, "in_progress");
  assert.strictEqual(pkg.checkpoint.id, checkpointId);
  assert.strictEqual(pkg.artifacts.length, 2);
  assert.ok(pkg.instructions_for_receiving_agent.includes("CONTINUATION INSTRUCTIONS FOR: Cursor IDE"));
  assert.ok(pkg.instructions_for_receiving_agent.includes("Implement queue persistence layer"));
  assert.ok(pkg.handoff_summary.includes("broker-core-implemented"));
});

// 11. Storage Budget Enforcement
await test("Storage budget calculates usage and maintains normal status below quota", async () => {
  const budget = getStorageBudget(testUserId);
  assert.strictEqual(budget.user_id, testUserId);
  assert.strictEqual(budget.status, "normal");
  assert.ok(budget.used_bytes > 0);
  assert.ok(budget.percent_used < 70);
});

// 12. Security & Workspace Isolation
await test("Unauthorized user cannot read other user's tasks or artifacts", async () => {
  const unauthTask = getTaskById(unauthorizedUserId, taskId);
  assert.strictEqual(unauthTask, null, "Other users must not access the task");

  const unauthArt = getArtifact(unauthorizedUserId, taskId, "src/queue/broker.ts");
  assert.strictEqual(unauthArt, null, "Other users must not access artifacts");
});

console.log("\n================================================================================");
console.log(`RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
console.log("================================================================================\n");

if (passed !== total) {
  process.exit(1);
}
