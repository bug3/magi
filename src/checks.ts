/**
 * The checks module's public surface: the vocabulary catalog, the shell-free
 * planner and the recording runner.
 */

export { planCheck, type CheckPlan } from "./checks/plan.ts";
export {
  runHardened,
  runProposedChecks,
  type CheckRecord,
  type CheckRunInputs,
  type HardenedRunRecord,
} from "./checks/run.ts";
export { CHECK_VOCABULARY, type VocabularyEntry } from "./checks/vocabulary.ts";
