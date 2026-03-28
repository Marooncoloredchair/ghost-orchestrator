import { evaluateAction } from "./safety";
import { proposeWithOpenClaw } from "./providers/openClawProvider";
import type { GhostResult, TargetAction } from "./types";

export const GHOST_NAME = "Ghost";
export const GHOST_VERSION = "0.1.0";

export async function runGhost(goal: string, providedAction?: TargetAction): Promise<GhostResult> {
  const trimmedGoal = goal.trim();
  if (!trimmedGoal) {
    throw new Error("goal is required");
  }

  let proposalSource: GhostResult["proposalSource"] = "provided";
  let proposedToolRaw: string | null = null;
  let proposedAction: TargetAction;

  if (providedAction) {
    proposedAction = providedAction;
    proposedToolRaw = typeof providedAction === "string" ? providedAction : JSON.stringify(providedAction);
  } else {
    const proposal = await proposeWithOpenClaw(trimmedGoal);
    proposalSource = proposal.source;
    proposedToolRaw = proposal.rawModel;
    proposedAction = proposal.targetAction;
  }

  const evalResult = await evaluateAction(proposedAction);
  return {
    goal: trimmedGoal,
    proposalSource,
    proposedToolRaw,
    proposedAction,
    verdict: evalResult.verdict,
    rationale: evalResult.rationale,
    riskScore: evalResult.riskScore,
    actionType: evalResult.actionType,
    auditedOutput: evalResult.auditedOutput,
    agentMessages: evalResult.messages,
    rules: evalResult.rules,
  };
}
