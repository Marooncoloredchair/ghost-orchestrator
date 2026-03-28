import type { RiskSignals, RuleLevel } from "./types";

type RuleScan = {
  level: RuleLevel;
  matched: string[];
};

const CRITICAL = [
  { pattern: /\bpassword\b/i, label: "password" },
  { pattern: /\bsend all data\b/i, label: "send all data" },
  { pattern: /\bdatabase\b/i, label: "database" },
  { pattern: /\bprivate\b/i, label: "private" },
  { pattern: /\b(credential|api[_\s-]?key|secret|token)\b/i, label: "credentials" },
  {
    pattern: /\b(send|exfil|leak|dump).{0,24}(all|every|full).{0,12}(data|database|rows|backup)\b/i,
    label: "bulk data exfiltration",
  },
  {
    pattern: /\b(bypass|circumvent).{0,20}(auth|authentication|2fa|mfa|login)\b/i,
    label: "auth bypass",
  },
];

const CAUTION = [
  { pattern: /\b(scrape|scraping|crawl).{0,30}(every|all|entire)\b/i, label: "bulk scraping" },
  { pattern: /\b(mass|bulk).{0,12}(email|sms|dm|message)\b/i, label: "mass outreach" },
  { pattern: /\b(pii|ssn|social security|credit card)\b/i, label: "sensitive data" },
  { pattern: /\bdelete.{0,20}(all|production|database)\b/i, label: "destructive action" },
];

const PII = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    label: "email address",
  },
  {
    pattern: /\b(?:\d[ -]*?){13,16}\b/,
    label: "card-like number",
  },
  {
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/,
    label: "ssn-like number",
  },
  {
    pattern: /\b(?:sk|rk)_(live|test)_[A-Za-z0-9]{12,}\b/i,
    label: "api key token",
  },
];

function ruleScan(task: string): RuleScan {
  const matched: string[] = [];

  for (const { pattern, label } of CRITICAL) {
    if (pattern.test(task)) matched.push(label);
  }
  if (matched.length) return { level: "critical", matched: [...new Set(matched)] };

  const cautionHits: string[] = [];
  for (const { pattern, label } of CAUTION) {
    if (pattern.test(task)) cautionHits.push(label);
  }
  if (cautionHits.length) return { level: "caution", matched: [...new Set(cautionHits)] };

  return { level: "none", matched: [] };
}

export function scanRiskSignals(input: string): RiskSignals {
  const base = ruleScan(input);
  const piiFlags: string[] = [];
  for (const { pattern, label } of PII) {
    if (pattern.test(input)) piiFlags.push(label);
  }

  let riskScore = 10;
  if (base.level === "caution") riskScore += 30;
  if (base.level === "critical") riskScore += 60;
  riskScore += Math.min(20, piiFlags.length * 8);
  riskScore = Math.max(0, Math.min(100, riskScore));

  const level: RuleLevel =
    base.level === "critical" || riskScore >= 70
      ? "critical"
      : base.level === "caution" || riskScore >= 40
        ? "caution"
        : "none";

  return {
    level,
    matched: [...new Set(base.matched)],
    piiFlags: [...new Set(piiFlags)],
    riskScore,
  };
}
