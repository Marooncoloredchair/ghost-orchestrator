import { scanRiskSignals } from "./rules";
import type {
  ActionType,
  AgentMessage,
  Decision,
  RiskSignals,
  TargetAction,
} from "./types";

function normalizeAction(targetAction: TargetAction): {
  actionType: ActionType;
  summary: string;
  rawText: string;
} {
  if (typeof targetAction === "string") {
    return {
      actionType: "text",
      summary: targetAction,
      rawText: targetAction,
    };
  }

  const tool = targetAction.tool ?? "unknown_tool";
  const endpoint = targetAction.endpoint ?? "";
  const payload = targetAction.payload ?? {};
  const provided = targetAction.type;
  const derived: ActionType =
    provided ??
    (/stripe|paypal|quickbooks|invoice|payment|wire/i.test(`${tool} ${endpoint}`)
      ? "financial"
      : /email|slack|sms|send/i.test(`${tool} ${endpoint}`)
        ? "external_comm"
        : /db|database|sql|query|record|customer|crm/i.test(`${tool} ${endpoint}`)
          ? "data_access"
          : "api_call");

  const summary = [
    `Tool Call: ${tool}${endpoint ? ` ${endpoint}` : ""}`,
    `Intent: ${targetAction.intent ?? "not provided"}`,
    `Payload: ${JSON.stringify(payload, null, 2)}`,
  ].join("\n");

  return {
    actionType: derived,
    summary,
    rawText: `${summary}\n${targetAction.text ?? ""}`,
  };
}

function executorAnalysis(actionSummary: string, actionType: ActionType): string {
  return [
    "Executor (optimist):",
    `Action type: ${actionType}`,
    "Goal interpretation and touched systems:",
    actionSummary,
  ].join("\n");
}

function redTeamAnalysis(
  actionSummary: string,
  actionType: ActionType,
  rules: RiskSignals,
  baselineRisk: number,
): string {
  const findings: string[] = [];
  if (rules.matched.length) findings.push(`rule flags: ${rules.matched.join(", ")}`);
  if (rules.piiFlags.length) findings.push(`pii flags: ${rules.piiFlags.join(", ")}`);
  if (actionType === "financial") findings.push("financial tool call: potential payment fraud / BEC attack");
  if (actionType === "external_comm") findings.push("external comms: potential data exfiltration");
  if (actionType === "data_access") findings.push("data access operation: possible over-broad scope");
  if (/rm -rf|drop table|truncate|delete from|shutdown/i.test(actionSummary)) {
    findings.push("destructive command signature detected");
  }

  const twist = actionSummary.length > 180 ? `${actionSummary.slice(0, 180)}...` : actionSummary;
  return [
    "Red Team (adversary):",
    `Baseline risk: ${baselineRisk}/100`,
    findings.length ? `Critical findings: ${findings.join(" | ")}` : "No obvious exploit chain found.",
    "",
    "Abuse narrative:",
    `An attacker could reinterpret this action as: ${twist}`,
  ].join("\n");
}

function auditor(
  actionType: ActionType,
  rules: RiskSignals,
  baselineRisk: number,
  redTeamMsg: string,
): { decision: Decision; rationale: string; modifications?: string } {
  const riskScore = Math.max(
    baselineRisk,
    rules.riskScore + (actionType === "financial" ? 20 : 0),
  );

  if (
    riskScore >= 80 ||
    /destructive command signature|payment fraud|bec attack/i.test(redTeamMsg)
  ) {
    return {
      decision: "BLOCK",
      rationale:
        "High-confidence risk detected for real-world execution. Manual verification required.",
    };
  }

  if (riskScore >= 45 || rules.level === "caution") {
    return {
      decision: "MODIFY",
      rationale:
        "Action is potentially valid but must be constrained with safety guardrails before execution.",
      modifications:
        "Safe version: scope to minimum required fields, mask PII, require explicit confirmation, and log action for audit trail.",
    };
  }

  return {
    decision: "APPROVE",
    rationale: "No high-risk indicators found. Action can proceed.",
  };
}

export async function evaluateAction(targetAction: TargetAction): Promise<{
  verdict: Decision;
  rationale: string;
  auditedOutput: string;
  riskScore: number;
  actionType: ActionType;
  messages: AgentMessage[];
  rules: RiskSignals;
}> {
  const normalized = normalizeAction(targetAction);
  const rules = scanRiskSignals(normalized.rawText);

  const baselineRisk =
    normalized.actionType === "financial"
      ? 75
      : normalized.actionType === "external_comm"
        ? 45
        : normalized.actionType === "data_access"
          ? 50
          : normalized.actionType === "api_call"
            ? 35
            : 15;

  const [exec, rt] = await Promise.all([
    Promise.resolve(executorAnalysis(normalized.summary, normalized.actionType)),
    Promise.resolve(redTeamAnalysis(normalized.summary, normalized.actionType, rules, baselineRisk)),
  ]);
  const aud = auditor(normalized.actionType, rules, baselineRisk, rt);

  const messages: AgentMessage[] = [
    { role: "executor", content: exec },
    { role: "redTeamer", content: rt },
    {
      role: "auditor",
      content: [
        "Assessment:",
        `Decision: ${aud.decision}`,
        `Rationale: ${aud.rationale}`,
        aud.modifications ? `\n${aud.modifications}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const original = typeof targetAction === "string" ? targetAction : targetAction.text ?? normalized.summary;
  let auditedOutput = original;
  if (aud.decision === "BLOCK") {
    auditedOutput =
      "Blocked by Ghost. This action cannot execute safely. Verify intent, identity, and authorization, then retry with narrower scope.";
  } else if (aud.decision === "MODIFY") {
    auditedOutput = [
      "Modified by Ghost:",
      "",
      original.trim(),
      "",
      "Added guardrails:",
      "- Minimize scope to required records only",
      "- Mask PII and secrets before transmission",
      "- Require explicit human confirmation for external side effects",
      "- Persist action log and rationale for audit",
    ].join("\n");
  }

  const riskScore = Math.max(
    baselineRisk,
    rules.riskScore + (normalized.actionType === "financial" ? 20 : 0),
  );

  return {
    verdict: aud.decision,
    rationale: aud.rationale,
    auditedOutput,
    riskScore: Math.max(0, Math.min(100, riskScore)),
    actionType: normalized.actionType,
    messages,
    rules,
  };
}
