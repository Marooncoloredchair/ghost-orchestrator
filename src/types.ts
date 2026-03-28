export type Decision = "APPROVE" | "BLOCK" | "MODIFY";

export type ActionType =
  | "text"
  | "api_call"
  | "financial"
  | "data_access"
  | "external_comm";

export type RuleLevel = "none" | "caution" | "critical";

export type RiskSignals = {
  level: RuleLevel;
  matched: string[];
  piiFlags: string[];
  riskScore: number;
};

export type AgentKey = "executor" | "redTeamer" | "auditor";

export type AgentMessage = {
  role: AgentKey;
  content: string;
};

export type TargetAction =
  | string
  | {
      type?: ActionType;
      intent?: string;
      tool?: string;
      endpoint?: string;
      payload?: Record<string, unknown>;
      text?: string;
    };

export type GhostResult = {
  goal: string;
  proposalSource: "openclaw" | "fallback" | "provided";
  proposedAction: TargetAction;
  proposedToolRaw: string | null;
  verdict: Decision;
  rationale: string;
  riskScore: number;
  actionType: ActionType;
  auditedOutput: string;
  agentMessages: AgentMessage[];
  rules: RiskSignals;
};
