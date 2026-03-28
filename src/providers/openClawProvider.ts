import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { TargetAction } from "../types";

const execFileAsync = promisify(execFile);

const OpenClawProposalSchema = z.object({
  tool: z.string().min(1),
  endpoint: z.string().optional(),
  intent: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

type OpenClawProviderResult = {
  targetAction: TargetAction;
  rawModel: string | null;
  source: "openclaw" | "fallback";
};

function fallbackAction(goal: string): TargetAction {
  const g = goal.toLowerCase();
  if (/invoice|pay|stripe|wire|vendor/i.test(g)) {
    return {
      tool: "execute_stripe_payment",
      endpoint: "stripe",
      intent: goal.slice(0, 200),
      payload: {
        amount: 4850,
        currency: "USD",
        vendor: "CloudSec_Global",
        iban: "DE89 NEW-UNVERIFIED-IBAN",
      },
    };
  }

  if (/email|send|slack|message|notify/i.test(g)) {
    return {
      tool: "send_email",
      endpoint: "smtp",
      intent: goal.slice(0, 200),
      payload: {
        to: "team@company.com",
        subject: "Update",
        body: "...",
      },
    };
  }

  return {
    tool: "update_crm_record",
    endpoint: "internal_api",
    intent: goal.slice(0, 200),
    payload: { recordId: "cust_10293", fields: { notes: "AI-suggested update" } },
  };
}

function parseCandidate(raw: unknown, goal: string): OpenClawProviderResult | null {
  const parsed = OpenClawProposalSchema.safeParse(raw);
  if (!parsed.success) return null;

  const data = parsed.data;
  return {
    targetAction: {
      tool: data.tool,
      endpoint: data.endpoint,
      intent: data.intent ?? goal,
      payload: data.payload ?? {},
      text: JSON.stringify(data),
    },
    rawModel: JSON.stringify(data),
    source: "openclaw",
  };
}

function detectMode(): "auto" | "cli" | "url" {
  const raw = (process.env.OPENCLAW_MODE ?? "auto").trim().toLowerCase();
  if (raw === "cli" || raw === "url") return raw;
  return "auto";
}

function extractLastJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace matching.
  }

  // Best effort: parse the last complete {...} block from stdout.
  const end = trimmed.lastIndexOf("}");
  if (end === -1) return null;

  let depth = 0;
  let start = -1;
  for (let i = end; i >= 0; i -= 1) {
    const ch = trimmed[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      depth -= 1;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) return null;

  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function toProposalFromAgentText(text: string, goal: string): OpenClawProviderResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // OpenClaw agent text may include prose + JSON. Parse best effort.
  const parsed = extractLastJsonObject(trimmed);
  if (!parsed) return null;
  return parseCandidate(parsed, goal);
}

async function proposeViaOpenClawCli(goal: string): Promise<OpenClawProviderResult | null> {
  const cmd = (process.env.OPENCLAW_CMD ?? "openclaw").trim() || "openclaw";
  const sessionId = (process.env.OPENCLAW_SESSION_ID ?? "ghost-orchestrator").trim();
  const profile = (process.env.OPENCLAW_PROFILE ?? "").trim();
  const timeoutMs = Math.max(
    10_000,
    Number.parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "90000", 10) || 90_000,
  );

  const modelPrompt = [
    "You are proposing a single next tool call.",
    "Return ONLY one JSON object (no markdown, no extra text):",
    '{"tool":"string","endpoint":"string optional","intent":"string","payload":{}}',
    `Goal: ${goal}`,
  ].join("\n");

  const args = [
    ...(profile ? ["--profile", profile] : []),
    "agent",
    "--local",
    "--session-id",
    sessionId,
    "--message",
    modelPrompt,
    "--json",
  ];

  const childEnv = { ...process.env, FORCE_COLOR: "0" };
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
    env: childEnv,
  });

  const envelope = extractLastJsonObject(stdout) as
    | { payloads?: Array<{ text?: string }> }
    | null;
  const payloadText = envelope?.payloads?.find((p) => typeof p.text === "string")?.text?.trim();

  if (!payloadText) {
    const fallbackFromStdout = toProposalFromAgentText(stdout, goal);
    if (fallbackFromStdout) return fallbackFromStdout;
    throw new Error(
      `OpenClaw CLI returned no text payload. stderr=${stderr?.slice(0, 400) ?? ""}`,
    );
  }

  const parsed = toProposalFromAgentText(payloadText, goal);
  if (!parsed) {
    throw new Error(`OpenClaw payload text did not match expected JSON schema: ${payloadText}`);
  }
  return parsed;
}

async function proposeViaUrl(goal: string): Promise<OpenClawProviderResult | null> {
  const url = process.env.OPENCLAW_PROPOSE_URL?.trim();
  if (!url) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.OPENCLAW_API_KEY?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) {
    throw new Error(`OpenClaw URL error: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as unknown;
  const direct = parseCandidate(body, goal);
  if (direct) return direct;
  if (body && typeof body === "object") {
    const nested = parseCandidate((body as Record<string, unknown>).proposedAction, goal);
    if (nested) return nested;
  }
  throw new Error("OpenClaw URL response shape mismatch");
}

export async function proposeWithOpenClaw(goal: string): Promise<OpenClawProviderResult> {
  const trimmed = goal.trim();
  if (!trimmed) {
    return {
      targetAction: fallbackAction("empty"),
      rawModel: null,
      source: "fallback",
    };
  }

  const mode = detectMode();
  try {
    if (mode === "cli") {
      const proposal = await proposeViaOpenClawCli(trimmed);
      if (proposal) return proposal;
      throw new Error("OpenClaw CLI mode enabled but unavailable");
    }

    if (mode === "url") {
      const proposal = await proposeViaUrl(trimmed);
      if (proposal) return proposal;
      throw new Error("OpenClaw URL mode enabled but OPENCLAW_PROPOSE_URL is empty");
    }

    // auto: try URL first (if configured), then CLI.
    const urlProposal = await proposeViaUrl(trimmed).catch(() => null);
    if (urlProposal) return urlProposal;

    const cliProposal = await proposeViaOpenClawCli(trimmed).catch(() => null);
    if (cliProposal) return cliProposal;

    return {
      targetAction: fallbackAction(trimmed),
      rawModel: "openclaw unavailable in auto mode; using fallback",
      source: "fallback",
    };
  } catch (err) {
    return {
      targetAction: fallbackAction(trimmed),
      rawModel: err instanceof Error ? err.message : String(err),
      source: "fallback",
    };
  }
}
