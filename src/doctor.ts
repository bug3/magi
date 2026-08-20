/**
 * The doctor module's public surface: quota-free static checks by default,
 * quota-spending live smoke only behind an explicit request.
 */

export {
  CALIBRATION_LAYERS,
  NONCE_MARKER,
  RECOVERY_FILE,
  calibrateCanaries,
  unisolatedProfile,
  type CalibrateInputs,
  type CalibrationReport,
} from "./doctor/calibrate.ts";
export {
  calibrationHealth,
  readCalibrationRows,
  type CalibrationHealthReport,
  type LayerFact,
  type SeatedVersion,
} from "./doctor/calibration-health.ts";
export {
  COMPLETENESS_PARAMS,
  completenessFromLedger,
  gateExpectedReader,
  type CompletenessParams,
  type ConsultCompleteness,
  type ExpectedFinding,
  type ExpectedReader,
} from "./doctor/completeness.ts";
export {
  formatCalibration,
  formatCalibrationHealth,
  formatCompleteness,
  formatSmokeResults,
  formatStaticReport,
  formatTelemetry,
} from "./doctor/format.ts";
export { liveSmoke, type SmokeResult } from "./doctor/live-smoke.ts";
export {
  SKEW_PARAMS,
  skewFromLedger,
  type SkewParams,
  type SkewReport,
  type SkewState,
} from "./doctor/skew.ts";
export {
  staticChecks,
  type SeatStaticReport,
  type StaticProbes,
  type StaticReport,
} from "./doctor/static-checks.ts";
export {
  VALUE_BAND,
  VALUE_CHECKPOINT_CONSULTS,
  valueFromLedger,
  type ValueBand,
  type ValueReport,
} from "./doctor/value.ts";
