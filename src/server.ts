import express from "express";
import { z } from "zod";
import { GHOST_NAME, GHOST_VERSION, runGhost } from "./ghost";
import type { TargetAction } from "./types";
import { loadEnvFiles } from "./env";

const envResult = loadEnvFiles();

const app = express();
app.use(express.json({ limit: "1mb" }));

const requestSchema = z.object({
  goal: z.string().min(1),
  proposedAction: z
    .union([
      z.string(),
      z.object({
        type: z.enum(["text", "api_call", "financial", "data_access", "external_comm"]).optional(),
        intent: z.string().optional(),
        tool: z.string().optional(),
        endpoint: z.string().optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        text: z.string().optional(),
      }),
    ])
    .optional(),
});

app.get("/health", (_req, res) => {
  const mode = (process.env.OPENCLAW_MODE ?? "auto").trim().toLowerCase();
  res.json({
    ok: true,
    service: GHOST_NAME,
    version: GHOST_VERSION,
    env: {
      loadedFiles: envResult.loadedFiles,
    },
    openClaw: {
      mode,
      urlConfigured: Boolean(process.env.OPENCLAW_PROPOSE_URL),
      cliCommand: process.env.OPENCLAW_CMD ?? "openclaw",
    },
  });
});

app.post("/v1/ghost/run", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const body = parsed.data;
    const providedAction = body.proposedAction as TargetAction | undefined;
    const result = await runGhost(body.goal, providedAction);
    return res.json({
      ghost: { name: GHOST_NAME, version: GHOST_VERSION },
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: message,
      ghost: { name: GHOST_NAME, version: GHOST_VERSION },
    });
  }
});

app.post("/v1/ghost/simulate", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const body = parsed.data;
    const providedAction = body.proposedAction as TargetAction | undefined;
    const result = await runGhost(body.goal, providedAction);

    const wouldExecute = result.verdict === "APPROVE";
    const simulatedExecution = wouldExecute
      ? {
          status: "would_execute",
          note: "Simulation only. No real side effects were performed.",
        }
      : {
          status: "stopped_by_ghost",
          note: "Simulation stopped due to non-APPROVE verdict.",
        };

    return res.json({
      ghost: { name: GHOST_NAME, version: GHOST_VERSION },
      mode: "simulation",
      wouldExecute,
      simulatedExecution,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({
      error: message,
      ghost: { name: GHOST_NAME, version: GHOST_VERSION },
      mode: "simulation",
    });
  }
});

const port = Number(process.env.PORT ?? "8787");
app.listen(port, () => {
  console.log(`[Ghost] listening on http://localhost:${port}`);
});
