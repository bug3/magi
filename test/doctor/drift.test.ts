import assert from "node:assert/strict";
import { test } from "node:test";

import { profileFlagsOf, undocumentedFlags } from "../../src/doctor/drift.ts";

test("long and short profile flags are read off argv while values are ignored", () => {
  assert.deepEqual(
    profileFlagsOf(["exec", "--sandbox", "read-only", "-C", "/x", "-c", "x=y", "-c", "z=y", "--json", "--key=value"]),
    ["--sandbox", "-C", "-c", "--json", "--key"],
  );
});

test("a flag the help text never mentions is drift", () => {
  const help = "Usage: tool --sandbox <mode> --json";
  assert.deepEqual(undocumentedFlags(["--sandbox", "read-only", "--json", "--gone"], help), [
    "--gone",
  ]);
});

test("no drift reads as an empty list, not as absence of a report", () => {
  assert.deepEqual(undocumentedFlags(["--json"], "supports --json"), []);
});

test("a longer flag cannot impersonate the exact short or long flag", () => {
  assert.deepEqual(undocumentedFlags(["--json", "-c"], "supports --json-schema and --config"), [
    "--json",
    "-c",
  ]);
});
