/**
 * The consult module's public surface. Callers import this facade; the
 * pieces behind it can move without any call site noticing.
 */

export { NON_PACK_FENCE_BUDGET_LINES, gateBrief, type BriefGateReport } from "./consult/brief-gate.ts";
export { gateSeatOutput, type SeatVerdict } from "./consult/gate.ts";
export {
  estimateBriefTokens,
  formatHeadroomReport,
  headroomReport,
  loadHeadroomConfig,
  type HeadroomConfig,
  type HeadroomReport,
  type HeadroomSnapshot,
} from "./consult/headroom.ts";
export { nextConsultId } from "./consult/id.ts";
export {
  appendLedgerBackfill,
  appendLedgerCalibration,
  appendLedgerRow,
  foldLedger,
  type FoldedConsult,
  type LedgerBackfill,
  type LedgerCalibration,
  type LedgerDisposition,
  type LedgerRow,
} from "./consult/ledger.ts";
export {
  citedIds,
  normalizeOpinion,
  type Opinion,
  type OpinionFinding,
} from "./consult/opinion.ts";
export { consultPaths, consultsDir, ledgerPath, type ConsultPaths } from "./consult/paths.ts";
export { renderTemplate, templateTokens } from "./consult/render.ts";
export {
  runConsult,
  type BriefFenceAccount,
  type ConsultRunInputs,
  type ConsultRunResult,
} from "./consult/run.ts";
export { consultStatus } from "./consult/status.ts";
export { stateIgnoreStatus, type StateIgnoreStatus } from "./consult/state-ignore.ts";
export {
  RISK_DOMAINS,
  TRIGGER_THRESHOLDS,
  evaluateTriggers,
  parseNumstat,
  type ChangedFile,
  type RiskDomain,
  type TriggerProposal,
  type TriggerThresholds,
} from "./consult/triggers.ts";
export { triggerChanges } from "./consult/trigger-changes.ts";
export { renderSynthesisScaffold } from "./consult/synthesis.ts";
