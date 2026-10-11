import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const enginePath = path.resolve(__dirname, "../mcp-server-alpic/server/src/services/continuity-engine.ts");
const {
  createContinuityTask,
  saveArtifact,
  createCheckpoint,
  getAllTasks,
} = await import(pathToFileURL(enginePath).href);

const userId = "eb049ac8-5cee-4d7e-a1d4-0d4698030f76";

console.log("Seeding Stripe Webhook Handler task for user:", userId);

// 1. Create Task
const task = await createContinuityTask(null, userId, {
  title: "Stripe Webhook Handler",
  objective: "Implement an idempotent Stripe webhook handler in TypeScript with signature verification, event routing, and order fulfillment.",
  planSteps: [
    "Configure Stripe SDK and verify webhook secret header",
    "Scaffold webhook route and signature verification",
    "Implement event dispatcher for payment_intent.succeeded and customer.subscription.created",
    "Persist transaction events and trigger order fulfillment",
    "Add unit tests and replay testing",
  ],
  sourcePlatform: "chatgpt",
  sourceAgent: "twin",
});

console.log("✅ Task created with ID:", task.id);

// 2. Save Artifacts
const stripeCode = `import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function handleStripeWebhook(req: Request): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig!, endpointSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(\`Webhook Error: \${err.message}\`, { status: 400 });
  }

  // Event routing
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      console.log("PaymentIntent succeeded:", paymentIntent.id);
      // Incomplete: persist to database and trigger order fulfillment
      break;
    }
    default:
      console.log(\`Unhandled event type: \${event.type}\`);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
`;

const art = await saveArtifact(null, userId, task.id, {
  path: "src/webhooks/stripe.ts",
  content: stripeCode,
  status: "partially_generated",
  sourcePlatform: "chatgpt",
});

console.log("✅ Artifact saved:", art.path, "v" + art.version, "hash:", art.content_hash.slice(0, 8));

// 3. Create Checkpoint
const cp = await createCheckpoint(null, userId, task.id, {
  name: "webhook-handler-scaffolded",
  summary: "Stripe SDK initialized, webhook signature verification implemented with constructEvent, basic switch scaffolded.",
  completedSteps: [
    { id: "step-1", description: "Configure Stripe SDK and verify webhook secret header", status: "completed" },
    { id: "step-2", description: "Scaffold webhook route and signature verification", status: "completed" },
  ],
  pendingSteps: [
    { id: "step-3", description: "Implement event dispatcher for payment_intent.succeeded and customer.subscription.created", status: "pending" },
    { id: "step-4", description: "Persist transaction events and trigger order fulfillment", status: "pending" },
    { id: "step-5", description: "Add unit tests and replay testing", status: "pending" },
  ],
  nextRecommendedAction: "Implement event dispatcher for payment_intent.succeeded to update order state in database and notify customer.",
  gitRef: "main:head",
});

console.log("✅ Checkpoint created:", cp.id, cp.name);

const all = getAllTasks(userId);
console.log("Total user tasks in store:", all.length);
all.forEach((t) => console.log(` - [${t.current_state}] ${t.title} (${t.id})`));
