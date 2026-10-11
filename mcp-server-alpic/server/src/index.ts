import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { withAuth, setupOAuthRoutes } from "./auth.js";
import { createUserClient } from "./services/supabase.js";
import {
  saveMemory,
  searchMemories,
  extractAllMemories,
} from "./services/memory.js";
import { askAgent } from "./services/agent-engine.js";
import {
  listAvailableAgents,
  createCollaborativePlan,
} from "./services/plan-engine.js";
import { savePlan, getPlan, listPlans } from "./services/plan-storage.js";
import {
  getUnreadNotifications,
  markAllRead,
  createNotification,
} from "./services/notification-service.js";
import { checkAvailability } from "./services/calendar-service.js";
import {
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
  getAllTasks,
  findTask,
  getTaskTransitions,
  getStorageBudget,
  type TaskState,
  type ArtifactStatus,
} from "./services/continuity-engine.js";

// ============================================
// Response helpers (match mcp-use format)
// ============================================
function object<T>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    _meta: { mimeType: "application/json" },
  };
}

function text(content: string) {
  return {
    content: [{ type: "text" as const, text: content }],
    _meta: { mimeType: "text/plain" },
  };
}

function mcpError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

// ============================================
// Server
// ============================================
const server = new McpServer(
  {
    name: "selfos",
    version: "1.0.0",
  },
  { capabilities: {} },
);

// Mount OAuth routes (discovery, login, token exchange)
setupOAuthRoutes(server);

server
  // ============================================
  // TOOL: save-memory
  // ============================================
  .registerTool(
    "save-memory",
    {
      description:
        "Save a piece of information about the user to their Digital Twin's persistent long-term memory. ALWAYS use this tool when the user shares personal facts, skills, preferences, decisions, projects, relationships, opinions, goals, or communication style. This is NOT ChatGPT's built-in memory — it stores data in the user's Digital Twin profile so their AI agent can represent them to other people's agents.",
      inputSchema: {
        content: z
          .string()
          .describe(
            "The memory content in natural language. Be specific and detailed. Example: 'Works as a full-stack developer specializing in React and Node.js at a startup in Turin'",
          ),
        category: z
          .string()
          .optional()
          .default("preference")
          .transform((val) => {
            const clean = (val || "").toLowerCase().trim();
            if (clean.includes("skill")) return "skill";
            if (clean.includes("pref")) return "preference";
            if (clean.includes("ident")) return "identity";
            if (clean.includes("decis")) return "decision";
            if (clean.includes("proj")) return "project";
            if (clean.includes("relat")) return "relationship";
            if (clean.includes("opin")) return "opinion";
            if (clean.includes("comm")) return "communication";
            if (clean.includes("goal")) return "goal";
            return "preference";
          })
          .describe(
            "Category: identity, skill, preference, decision, project, relationship, opinion, communication, goal",
          ),
        metadata: z
          .any()
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            if (typeof val === "object") return val;
            if (typeof val === "string") {
              try { return JSON.parse(val); } catch { return { text: val }; }
            }
            return undefined;
          })
          .describe(
            "Optional metadata as JSON string or object, e.g. '{\"source\":\"meeting\"}'",
          ),
      },
    },
    withAuth(async ({ content, category, metadata }, { userId, accessToken, clientSource }) => {
      try {
        console.log(`[save-memory] User: ${userId}, Category: ${category}`);
        console.log(`[save-memory] Content: ${content}`);
        const supabase = createUserClient(accessToken);
        const result = await saveMemory(supabase, userId, {
          content,
          category: category as any,
          source: clientSource,
          metadata,
        });
        console.log(`[save-memory] Success:`, result);
        return object(result);
      } catch (err) {
        console.error(`[save-memory] Error:`, err);
        return mcpError(`Error saving memory: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: search-memories
  // ============================================
  .registerTool(
    "search-memories",
    {
      description:
        "Search the user's Digital Twin memory using semantic search. Use this when the user asks 'what do you know about me?', 'what are my skills?', 'do you remember...?', or any question about previously saved information. Returns the most relevant memories ranked by similarity.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Natural language search query. Example: 'programming skills' or 'projects I'm working on'",
          ),
        category: z
          .string()
          .optional()
          .describe(
            "Optional filter: identity, skill, preference, decision, project, relationship, opinion, communication, goal",
          ),
        limit: z.number().default(10).describe("Max results to return (default 10)"),
      },
    },
    withAuth(async ({ query, category, limit }, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);
        const results = await searchMemories(supabase, userId, query, category, limit);
        return object({ results, count: results.length });
      } catch (err) {
        return mcpError(`Error searching memories: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: extract-all-memories
  // ============================================
  .registerTool(
    "extract-all-memories",
    {
      description:
        "Bulk import multiple memories at once into the Digital Twin. Use this when you have gathered several facts about the user from a conversation and want to save them all efficiently. Send a JSON array of memories with content and category for each. This is faster than calling save_memory multiple times.",
      inputSchema: {
        extraction_prompt: z
          .string()
          .describe(
            'JSON string containing memories to import. Format: array of {content: string, category: string}. Example: [{"content":"Loves Italian cuisine","category":"preference"},{"content":"Expert in Python","category":"skill"}]',
          ),
      },
    },
    withAuth(async ({ extraction_prompt }, { userId, accessToken, clientSource }) => {
      try {
        const supabase = createUserClient(accessToken);
        const result = await extractAllMemories(supabase, userId, extraction_prompt, clientSource);
        return object(result);
      } catch (err) {
        return mcpError(`Error extracting memories: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: ask-agent
  // ============================================
  .registerTool(
    "ask-agent",
    {
      description:
        "Ask a question to another user's Digital Twin agent. The agent will respond based on that person's stored memories, skills, and personality. Use this when the user wants feedback, advice, or a perspective from a connected friend's Digital Twin. Requires an accepted friend connection (set up via the Digital Twin webapp).",
      inputSchema: {
        target_user_display_name: z
          .string()
          .describe(
            "Display name of the person whose Digital Twin you want to ask (e.g. 'marco', 'giulia')",
          ),
        question: z
          .string()
          .describe("The question or request for the other person's Digital Twin"),
        context: z
          .string()
          .optional()
          .describe(
            "Additional context to help the agent give a better answer (e.g. a project plan to review)",
          ),
        interaction_type: z
          .enum(["feedback", "review", "brainstorm", "availability_check"])
          .optional()
          .describe(
            "Type of interaction: feedback (opinion), review (evaluate work), brainstorm (generate ideas), availability_check (check if available)",
          ),
      },
    },
    withAuth(
      async ({ target_user_display_name, question, context }, { userId, accessToken }) => {
        try {
          const supabase = createUserClient(accessToken);
          const result = await askAgent(
            supabase,
            userId,
            target_user_display_name,
            question,
            context,
          );
          return object(result);
        } catch (err) {
          return mcpError(`Error in interaction: ${String(err)}`);
        }
      },
    ),
  )

  // ============================================
  // TOOL: get-my-twin-status
  // ============================================
  .registerTool(
    "get-my-twin-status",
    {
      description:
        "Get the current status of the user's Digital Twin profile. Shows: total memories stored, number of friend connections, memory breakdown by category, and overall readiness. Use this when the user asks 'how is my twin?', 'what's my status?', 'how many memories do I have?', or wants an overview of their Digital Twin.",
      inputSchema: {},
    },
    withAuth(async (_input, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);

        const [{ data: agent }, { data: memories }, { count: connCount }] =
          await Promise.all([
            supabase
              .from("agents")
              .select("display_name, memory_count, status")
              .eq("user_id", userId)
              .single(),
            supabase
              .from("memories")
              .select("category")
              .eq("user_id", userId)
              .eq("is_active", true),
            supabase
              .from("connections")
              .select("id", { count: "exact", head: true })
              .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
              .eq("status", "accepted"),
          ]);

        const categories: Record<string, number> = {};
        for (const m of memories ?? []) {
          categories[m.category] = (categories[m.category] ?? 0) + 1;
        }

        return object({
          display_name: agent?.display_name ?? "Unknown",
          memory_count: agent?.memory_count ?? 0,
          connections_count: connCount ?? 0,
          categories,
          status: agent?.status ?? "unknown",
        });
      } catch (err) {
        return mcpError(`Error getting twin status: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // WIDGET: agent-selector (was list_agents)
  // ============================================
  .registerWidget(
    "agent-selector",
    { description: "Interactive agent selector for collaborative planning" },
    {
      description:
        "List all available agents for collaborative planning and show an interactive UI to select them. Returns specialist agents (Frontend, Backend, Security, DevOps, UX, PM, Data, Mobile) and connected friends' Digital Twins. Use this when the user asks 'show me the agents', 'which agents can I use?', 'who can help me plan?', 'build a team', or wants to create a collaborative plan.",
      inputSchema: {},
    },
    withAuth(async (_input, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);
        const result = await listAvailableAgents(supabase, userId);
        return object(result);
      } catch (err) {
        return mcpError(`Error retrieving agents: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: create-plan
  // ============================================
  .registerTool(
    "create-plan",
    {
      description:
        "Create a comprehensive project plan using a team of AI agents. Each agent contributes their expertise (frontend, backend, security, UX, etc.) and optionally friends' Digital Twins can participate too. The agents collaborate and their contributions are synthesized into a unified actionable plan. Use this when the user says 'create a plan', 'help me plan', 'build a plan with agents', or describes a project they want to plan. First call list_agents to show available agents, let the user pick, then call this tool.",
      inputSchema: {
        plan_description: z
          .string()
          .describe(
            "Detailed description of the project or feature to plan. Be as specific as possible.",
          ),
        agent_ids: z
          .array(z.string())
          .describe(
            "Array of agent IDs to include. Use IDs from list_agents: built-in IDs like 'frontend', 'backend', 'security', 'devops', 'ux', 'pm', 'data', 'mobile', or friend IDs like 'friend:username'",
          ),
        plan_name: z
          .string()
          .optional()
          .describe(
            "Short name for the plan (e.g. 'App iOS ElevenLabs'). If not provided, auto-generated from description.",
          ),
        context: z
          .string()
          .optional()
          .describe(
            "Optional additional context: existing tech stack, constraints, deadlines, team size, etc.",
          ),
      },
    },
    withAuth(
      async (
        { plan_description, agent_ids, plan_name, context },
        { userId, accessToken },
      ) => {
        try {
          const supabase = createUserClient(accessToken);
          const result = await createCollaborativePlan(
            supabase,
            userId,
            plan_description,
            agent_ids,
            context,
          );

          // Auto-save plan to database
          const name = plan_name ?? result.plan_title;
          const saved = await savePlan(
            supabase,
            userId,
            result,
            name,
            plan_description,
          );

          return object({
            ...result,
            saved_plan_id: saved.plan_id,
            saved_name: saved.name,
          });
        } catch (err) {
          return mcpError(`Error creating plan: ${String(err)}`);
        }
      },
    ),
  )

  // ============================================
  // TOOL: get-plan
  // ============================================
  .registerTool(
    "get-plan",
    {
      description:
        "Retrieve a saved collaborative plan by name or keyword search. Returns the full plan with all agent contributions and unified plan. Use when the user says 'get the plan for...', 'show me the plan...', 'open the plan...'. Returns the complete plan data so it can be used for implementation.",
      inputSchema: {
        search: z
          .string()
          .describe(
            "Name or keyword to search for in plan names/descriptions (e.g. 'app iOS', 'backend API')",
          ),
      },
    },
    withAuth(async ({ search }, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);
        const plan = await getPlan(supabase, userId, search);
        if (!plan) {
          return text("No plan found with that name. Try 'list my plans' to see all saved plans.");
        }
        return object(plan);
      } catch (err) {
        return mcpError(`Error searching plan: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: list-plans
  // ============================================
  .registerTool(
    "list-plans",
    {
      description:
        "List all saved collaborative plans. Use when the user says 'my plans', 'what plans do I have?', 'list my plans', 'show plans'.",
      inputSchema: {},
    },
    withAuth(async (_input, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);
        const plans = await listPlans(supabase, userId);
        if (plans.length === 0) {
          return text("You don't have any saved plans yet. Create a plan with the agent team!");
        }
        return object({ plans, count: plans.length });
      } catch (err) {
        return mcpError(`Error listing plans: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // WIDGET: notifications (was get_notifications)
  // ============================================
  .registerWidget(
    "notifications",
    { description: "User notifications display" },
    {
      description:
        "Get unread notifications for the user. Use when the user says 'what\\'s new?', 'any notifications?', 'news?', 'any updates?', 'what\\'s happening?', or any variation asking about news or notifications.",
      inputSchema: {
        mark_as_read: z
          .boolean()
          .default(false)
          .describe(
            "If true, mark all returned notifications as read after showing them",
          ),
      },
    },
    withAuth(async ({ mark_as_read }, { userId, accessToken }) => {
      try {
        const supabase = createUserClient(accessToken);
        const notifications = await getUnreadNotifications(supabase, userId);

        if (mark_as_read && notifications.length > 0) {
          await markAllRead(supabase, userId);
        }

        return object({ notifications });
      } catch (err) {
        return mcpError(`Error reading notifications: ${String(err)}`);
      }
    }),
  )

  // ============================================
  // TOOL: check-availability
  // ============================================
  .registerTool(
    "check-availability",
    {
      description:
        "Check if a connected friend is available on their Google Calendar. Use when the user asks 'is Marco free?', 'does Marco have time tomorrow?', 'is Marco free tomorrow?', or any variation asking about a friend's availability.",
      inputSchema: {
        target_display_name: z
          .string()
          .describe("Display name of the friend to check availability for"),
        date: z
          .string()
          .describe(
            "Date to check in ISO 8601 format (e.g. '2026-03-28'). Use today's date if not specified.",
          ),
        time_range: z
          .string()
          .optional()
          .describe(
            "Time range to check (e.g. 'afternoon', 'morning', '14:00-18:00'). Defaults to full day.",
          ),
      },
    },
    withAuth(
      async ({ target_display_name, date, time_range }, { userId, accessToken }) => {
        try {
          const supabase = createUserClient(accessToken);

          // Find target user
          const { data: targetUser } = await supabase
            .from("users")
            .select("id")
            .ilike("display_name", target_display_name)
            .single();

          if (!targetUser) {
            return text(`User "${target_display_name}" not found.`);
          }

          // Check connection
          const { data: connection } = await supabase
            .from("connections")
            .select("id")
            .or(
              `and(requester_id.eq.${userId},receiver_id.eq.${targetUser.id}),and(requester_id.eq.${targetUser.id},receiver_id.eq.${userId})`,
            )
            .eq("status", "accepted")
            .single();

          if (!connection) {
            return text(`You are not connected with ${target_display_name}. Send a connection request first.`);
          }

          // Parse time range
          let timeMin = `${date}T00:00:00Z`;
          let timeMax = `${date}T23:59:59Z`;

          if (time_range) {
            if (
              time_range.toLowerCase().includes("morn") ||
              time_range.toLowerCase().includes("mattin")
            ) {
              timeMin = `${date}T08:00:00Z`;
              timeMax = `${date}T13:00:00Z`;
            } else if (
              time_range.toLowerCase().includes("afternoon") ||
              time_range.toLowerCase().includes("pomeriggio")
            ) {
              timeMin = `${date}T13:00:00Z`;
              timeMax = `${date}T19:00:00Z`;
            } else if (time_range.includes("-")) {
              const [start, end] = time_range.split("-");
              timeMin = `${date}T${start.trim()}:00Z`;
              timeMax = `${date}T${end.trim()}:00Z`;
            }
          }

          const result = await checkAvailability(
            supabase,
            targetUser.id,
            timeMin,
            timeMax,
          );

          if (!result.hasCalendar) {
            return text(`${target_display_name} has not connected Google Calendar. Cannot check availability.`);
          }

          return object({
            target_name: target_display_name,
            date,
            time_range: time_range ?? "full day",
            available: result.busySlots.length === 0,
            busy_slots: result.busySlots,
            summary: result.freeMessage,
          });
        } catch (err) {
          return mcpError(`Error checking availability: ${String(err)}`);
        }
      },
    ),
  )

  // ============================================
  // TOOL: request-meeting
  // ============================================
  .registerTool(
    "request-meeting",
    {
      description:
        "Request a meeting with a connected friend. Creates a calendar request and notifies them. Use after checking availability with check_availability.",
      inputSchema: {
        target_display_name: z
          .string()
          .describe("Display name of the friend to meet with"),
        proposed_time: z
          .string()
          .describe(
            "Proposed meeting start time in ISO 8601 format (e.g. '2026-03-28T15:00:00Z')",
          ),
        duration_minutes: z
          .number()
          .default(30)
          .describe("Duration of the meeting in minutes"),
        message: z
          .string()
          .optional()
          .describe("Optional message explaining the meeting purpose"),
      },
    },
    withAuth(
      async (
        { target_display_name, proposed_time, duration_minutes, message },
        { userId, accessToken },
      ) => {
        try {
          const supabase = createUserClient(accessToken);

          // Find target user
          const { data: targetUser } = await supabase
            .from("users")
            .select("id, display_name")
            .ilike("display_name", target_display_name)
            .single();

          if (!targetUser) {
            return text(`User "${target_display_name}" not found.`);
          }

          // Get requester display name
          const { data: requester } = await supabase
            .from("users")
            .select("display_name")
            .eq("id", userId)
            .single();

          // Create calendar request
          const { data: calRequest, error: calError } = await supabase
            .from("calendar_requests")
            .insert({
              requester_id: userId,
              target_id: targetUser.id,
              proposed_time,
              duration_minutes,
              message: message ?? null,
            })
            .select()
            .single();

          if (calError) {
            return mcpError(`Error creating request: ${calError.message}`);
          }

          // Create notification for target
          await createNotification(
            supabase,
            targetUser.id,
            "calendar_request",
            `${requester?.display_name ?? "Someone"} wants to schedule a meeting with you`,
            message ??
              `Meeting proposed for ${new Date(proposed_time).toLocaleDateString("en-US")} at ${new Date(proposed_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} (${duration_minutes} min)`,
            {
              calendar_request_id: calRequest.id,
              requester_id: userId,
              proposed_time,
              duration_minutes,
            },
          );

          return text(
            `Meeting request sent to ${target_display_name}! Proposed meeting on ${new Date(proposed_time).toLocaleDateString("en-US")} at ${new Date(proposed_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} for ${duration_minutes} minutes. ${target_display_name} will receive a notification.`
          );
        } catch (err) {
          return mcpError(`Error requesting meeting: ${String(err)}`);
        }
      },
    ),
  );

// ============================================
// TOOL: list-agents (tool version of agent-selector widget)
// ============================================
server.registerTool(
  "list-agents",
  {
    description:
      "List all available agents for collaborative planning. Returns specialist agents (Frontend, Backend, Security, DevOps, UX, PM, Data, Mobile) and connected friends' Digital Twins. Use this when the user asks 'show me the agents', 'which agents can I use?', 'who can help me plan?', 'build a team', or wants to create a collaborative plan.",
    inputSchema: {},
  },
  withAuth(async (_input, { userId, accessToken }) => {
    try {
      const supabase = createUserClient(accessToken);
      const result = await listAvailableAgents(supabase, userId);
      return object(result);
    } catch (err) {
      return mcpError(`Error retrieving agents: ${String(err)}`);
    }
  }),
);

// ============================================
// TOOL: get-notifications (tool version of notifications widget)
// ============================================
server.registerTool(
  "get-notifications",
  {
    description:
      "Get unread notifications for the user. Use when the user says 'what\\'s new?', 'any notifications?', 'news?', 'any updates?', 'what\\'s happening?', or any variation asking about news or notifications.",
    inputSchema: {
      mark_as_read: z
        .boolean()
        .default(false)
        .describe(
          "If true, mark all returned notifications as read after showing them",
        ),
    },
  },
  withAuth(async ({ mark_as_read }, { userId, accessToken }) => {
    try {
      const supabase = createUserClient(accessToken);
      const notifications = await getUnreadNotifications(supabase, userId);

      if (mark_as_read && notifications.length > 0) {
        await markAllRead(supabase, userId);
      }

      return object({ notifications });
    } catch (err) {
      return mcpError(`Error reading notifications: ${String(err)}`);
    }
  }),
);

// ============================================
// WORK CONTINUITY ENGINE TOOLS
// ============================================

// 1. create-continuity-task
server.registerTool(
  "create-continuity-task",
  {
    description:
      "Initialize a new tracked task in the SelfOS Work Continuity Engine. Tracks objective, steps, checkpoints, artifacts, and state transitions so work can be paused, checkpointed, and resumed seamlessly across agents.",
    inputSchema: {
      title: z.string().describe("Short title of the task"),
      objective: z.string().describe("Detailed objective and acceptance criteria of the task"),
      project_id: z.string().optional().default("default").describe("Project identifier"),
      plan_steps: z.array(z.string()).optional().describe("Ordered list of plan step descriptions"),
      budget_bytes: z.number().optional().default(52428800).describe("Storage budget in bytes (default 50MB)"),
    },
  },
  withAuth(async ({ title, objective, project_id, plan_steps, budget_bytes }, { userId, accessToken, clientSource }) => {
    try {
      const supabase = createUserClient(accessToken);
      const task = await createContinuityTask(supabase, userId, {
        title,
        objective,
        projectId: project_id,
        planSteps: plan_steps,
        sourcePlatform: clientSource,
        budgetBytes: budget_bytes,
      });
      return object({
        status: "created",
        task,
        message: `Task "${task.title}" initialized with ID ${task.id}. State: ${task.current_state}`,
      });
    } catch (err) {
      return mcpError(`Error creating continuity task: ${String(err)}`);
    }
  })
);

// 1b. list-tasks
server.registerTool(
  "list-tasks",
  {
    description:
      "List all active, paused, interrupted, or completed tasks in the Work Continuity Engine. Returns task IDs, titles, current states, objectives, and latest checkpoints so any agent (like Cursor or ChatGPT) can discover and resume existing work.",
    inputSchema: {
      query: z.string().optional().describe("Optional search filter for task title or objective"),
      state: z.string().optional().describe("Optional filter by state (e.g. 'in_progress', 'paused', 'interrupted', 'completed')"),
    },
  },
  withAuth(async ({ query, state }, { userId }) => {
    try {
      let tasks = getAllTasks(userId);
      if (state) {
        tasks = tasks.filter((t) => t.current_state === state);
      }
      if (query) {
        const q = query.toLowerCase().trim();
        tasks = tasks.filter(
          (t) => t.title.toLowerCase().includes(q) || t.objective.toLowerCase().includes(q) || t.id.toLowerCase() === q
        );
      }
      return object({
        count: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          current_state: t.current_state,
          objective: t.objective,
          source_platform: t.source_platform,
          source_agent: t.source_agent,
          latest_checkpoint_id: t.latest_checkpoint_id ?? null,
          used_bytes: t.used_bytes,
          updated_at: t.updated_at,
        })),
      });
    } catch (err) {
      return mcpError(`Error listing tasks: ${String(err)}`);
    }
  })
);

// 2. update-task-state
server.registerTool(
  "update-task-state",
  {
    description:
      "Perform a validated state transition on a continuity task. Valid states: queued, in_progress, checkpointing, paused, interrupted, waiting_for_agent, resuming, validating, completed, failed, cancelled. Transition history is recorded.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      new_state: z.enum([
        "queued",
        "in_progress",
        "checkpointing",
        "paused",
        "interrupted",
        "waiting_for_agent",
        "resuming",
        "validating",
        "completed",
        "failed",
        "cancelled",
      ]).describe("New target state"),
      trigger: z.string().describe("What triggered this transition (e.g. 'checkpoint_created', 'agent_interrupted', 'tests_passed')"),
      checkpoint_id: z.string().optional().describe("Associated checkpoint ID if applicable"),
    },
  },
  withAuth(async ({ task_id, new_state, trigger, checkpoint_id }, { userId, accessToken, clientSource }) => {
    try {
      const supabase = createUserClient(accessToken);
      const result = await updateTaskState(supabase, userId, task_id, new_state as TaskState, {
        trigger,
        platform: clientSource,
        checkpointId: checkpoint_id,
      });
      return object({
        status: "updated",
        current_state: result.task.current_state,
        transition: result.transition,
      });
    } catch (err) {
      return mcpError(`Error updating task state: ${String(err)}`);
    }
  })
);

// 3. save-artifact
server.registerTool(
  "save-artifact",
  {
    description:
      "Save a recoverable code file, patch, or partial generation to the Work Continuity Engine. Automatically computes SHA-256 hash, redacts sensitive credentials, tracks version numbers, and deduplicates identical content.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      path: z.string().describe("Relative file path (e.g. 'src/components/Button.tsx' or 'requirements.md')"),
      content: z.string().describe("Full content of the file or partial code"),
      status: z.enum([
        "planned",
        "partially_generated",
        "persisted",
        "applied",
        "validated",
        "completed",
      ]).default("persisted").describe("Artifact status"),
      diff: z.string().optional().describe("Optional git diff or patch"),
    },
  },
  withAuth(async ({ task_id, path: filePath, content, status, diff }, { userId, accessToken, clientSource }) => {
    try {
      const supabase = createUserClient(accessToken);
      const artifact = await saveArtifact(supabase, userId, task_id, {
        path: filePath,
        content,
        status: status as ArtifactStatus,
        diff,
        sourcePlatform: clientSource,
      });
      return object({
        status: "saved",
        artifact_id: artifact.id,
        path: artifact.path,
        version: artifact.version,
        content_hash: artifact.content_hash,
        size_bytes: artifact.size_bytes,
        artifact_status: artifact.status,
      });
    } catch (err) {
      return mcpError(`Error saving artifact: ${String(err)}`);
    }
  })
);

// 4. get-artifact
server.registerTool(
  "get-artifact",
  {
    description: "Retrieve exact recoverable content and metadata for a saved file artifact.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      path: z.string().describe("File path to retrieve"),
      version: z.number().optional().describe("Optional specific version number (defaults to latest)"),
    },
  },
  withAuth(async ({ task_id, path: filePath, version }, { userId }) => {
    try {
      const artifact = getArtifact(userId, task_id, filePath, version);
      if (!artifact) {
        return mcpError(`Artifact "${filePath}" not found for task ${task_id}.`);
      }
      return object({ artifact });
    } catch (err) {
      return mcpError(`Error getting artifact: ${String(err)}`);
    }
  })
);

// 5. list-artifacts
server.registerTool(
  "list-artifacts",
  {
    description: "List all versioned recoverable artifacts for a continuity task.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
    },
  },
  withAuth(async ({ task_id }, { userId }) => {
    try {
      const artifacts = listTaskArtifacts(userId, task_id);
      return object({
        task_id,
        count: artifacts.length,
        artifacts: artifacts.map((a) => ({
          id: a.id,
          path: a.path,
          version: a.version,
          status: a.status,
          size_bytes: a.size_bytes,
          content_hash: a.content_hash.slice(0, 10),
          created_at: a.created_at,
        })),
      });
    } catch (err) {
      return mcpError(`Error listing artifacts: ${String(err)}`);
    }
  })
);

// 6. create-checkpoint
server.registerTool(
  "create-checkpoint",
  {
    description:
      "Create a point-in-time recovery checkpoint capturing completed steps, pending work, artifact snapshots, and the exact next recommended action so any agent can resume uninterrupted.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      name: z.string().describe("Descriptive checkpoint name (e.g. 'checkpoint-step-2-auth-wired')"),
      summary: z.string().describe("Summary of what was achieved and current state"),
      completed_steps: z.array(z.string()).describe("List of completed step descriptions"),
      pending_steps: z.array(z.string()).describe("List of remaining steps to do"),
      next_recommended_action: z.string().describe("Exact next action the resuming agent should take"),
      git_ref: z.string().optional().describe("Optional git commit SHA or branch"),
    },
  },
  withAuth(async ({ task_id, name, summary, completed_steps, pending_steps, next_recommended_action, git_ref }, { userId, accessToken }) => {
    try {
      const supabase = createUserClient(accessToken);
      const checkpoint = await createCheckpoint(supabase, userId, task_id, {
        name,
        summary,
        completedSteps: completed_steps.map((desc, i) => ({ id: `c-${i + 1}`, description: desc, status: "completed" })),
        pendingSteps: pending_steps.map((desc, i) => ({ id: `p-${i + 1}`, description: desc, status: "pending" })),
        nextRecommendedAction: next_recommended_action,
        gitRef: git_ref,
      });
      return object({
        status: "checkpoint_created",
        checkpoint_id: checkpoint.id,
        checkpoint,
      });
    } catch (err) {
      return mcpError(`Error creating checkpoint: ${String(err)}`);
    }
  })
);

// 7. get-checkpoint
server.registerTool(
  "get-checkpoint",
  {
    description: "Retrieve a specific checkpoint by ID.",
    inputSchema: {
      checkpoint_id: z.string().describe("Checkpoint UUID"),
    },
  },
  withAuth(async ({ checkpoint_id }, { userId }) => {
    try {
      const cp = getCheckpoint(userId, checkpoint_id);
      if (!cp) return mcpError(`Checkpoint ${checkpoint_id} not found.`);
      return object({ checkpoint: cp });
    } catch (err) {
      return mcpError(`Error getting checkpoint: ${String(err)}`);
    }
  })
);

// 8. list-checkpoints
server.registerTool(
  "list-checkpoints",
  {
    description: "List all chronological checkpoints for a continuity task.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
    },
  },
  withAuth(async ({ task_id }, { userId }) => {
    try {
      const checkpoints = listCheckpoints(userId, task_id);
      return object({
        task_id,
        count: checkpoints.length,
        checkpoints,
      });
    } catch (err) {
      return mcpError(`Error listing checkpoints: ${String(err)}`);
    }
  })
);

// 9. resume-task
server.registerTool(
  "resume-task",
  {
    description:
      "Resume an interrupted, paused, or handoff task. Restores the latest verified checkpoint, loads all required artifact versions, verifies hashes, and returns a complete continuation package for the receiving agent.",
    inputSchema: {
      task_id: z.string().describe("Task UUID to resume"),
      receiving_agent: z.string().optional().describe("Name/type of agent taking over (e.g. 'Cursor IDE', 'ChatGPT')"),
    },
  },
  withAuth(async ({ task_id, receiving_agent }, { userId, accessToken, clientSource }) => {
    try {
      const supabase = createUserClient(accessToken);
      const pkg = await resumeTask(supabase, userId, task_id, {
        receivingAgent: receiving_agent,
        receivingPlatform: clientSource,
      });
      return object(pkg);
    } catch (err) {
      return mcpError(`Error resuming task: ${String(err)}`);
    }
  })
);

// 10. pause-task
server.registerTool(
  "pause-task",
  {
    description: "Pause an in-progress task gracefully and create a durable checkpoint.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      reason: z.string().describe("Reason for pausing"),
      next_action: z.string().describe("Next action when resumed"),
    },
  },
  withAuth(async ({ task_id, reason, next_action }, { userId, accessToken, clientSource }) => {
    try {
      const supabase = createUserClient(accessToken);
      const cp = await createCheckpoint(supabase, userId, task_id, {
        name: `pause-${Date.now()}`,
        summary: `Task paused: ${reason}`,
        completedSteps: [],
        pendingSteps: [],
        nextRecommendedAction: next_action,
      });
      await updateTaskState(supabase, userId, task_id, "paused", {
        trigger: "user_pause_request",
        platform: clientSource,
        checkpointId: cp.id,
      });
      return object({
        status: "paused",
        task_id,
        checkpoint_id: cp.id,
        message: `Task paused successfully. Resume anytime with resume-task.`,
      });
    } catch (err) {
      return mcpError(`Error pausing task: ${String(err)}`);
    }
  })
);

// 11. get-task-status
server.registerTool(
  "get-task-status",
  {
    description: "Get full real-time status of a continuity task including state, checkpoints, transitions, and budget.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
    },
  },
  withAuth(async ({ task_id }, { userId }) => {
    try {
      const task = getTaskById(userId, task_id);
      if (!task) return mcpError(`Task ${task_id} not found.`);
      const transitions = getTaskTransitions(userId, task_id);
      const checkpoints = listCheckpoints(userId, task_id);
      const artifacts = listTaskArtifacts(userId, task_id);
      const budget = getStorageBudget(userId);
      return object({
        task,
        current_state: task.current_state,
        latest_checkpoint: checkpoints[0] ?? null,
        total_checkpoints: checkpoints.length,
        total_artifacts: artifacts.length,
        recent_transitions: transitions.slice(0, 5),
        storage_budget: budget,
      });
    } catch (err) {
      return mcpError(`Error getting task status: ${String(err)}`);
    }
  })
);

// 12. check-storage-budget
server.registerTool(
  "check-storage-budget",
  {
    description: "Check the user's Work Continuity storage budget, consumption, and threshold status (normal, warning, critical, exhausted).",
    inputSchema: {},
  },
  withAuth(async (_input, { userId }) => {
    try {
      const budget = getStorageBudget(userId);
      return object({ budget });
    } catch (err) {
      return mcpError(`Error checking storage budget: ${String(err)}`);
    }
  })
);

// 13. create-handoff
server.registerTool(
  "create-handoff",
  {
    description: "Generate a provider-neutral handoff package that can be exported or sent to another AI client or agent.",
    inputSchema: {
      task_id: z.string().describe("Task UUID"),
      target_platform: z.string().default("any").describe("Target platform or agent"),
    },
  },
  withAuth(async ({ task_id, target_platform }, { userId, accessToken }) => {
    try {
      const supabase = createUserClient(accessToken);
      const pkg = await resumeTask(supabase, userId, task_id, {
        receivingAgent: target_platform,
        receivingPlatform: target_platform,
      });
      return object({
        handoff_format: "selfos-continuity-v1",
        exported_at: new Date().toISOString(),
        package: pkg,
      });
    } catch (err) {
      return mcpError(`Error creating handoff: ${String(err)}`);
    }
  })
);

// ============================================
// Start server
// ============================================
server.run();

export type AppType = typeof server;
