import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { test } from "node:test";

import { ambient } from "../../src/cli/environment.ts";

/** Sets one variable for the body and restores it, set or unset, after. */
function withEnv(name: string, value: string | undefined, body: () => void): void {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    body();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

test("the three ambient values a seat is launched with come from the process", () => {
  withEnv("USER", "someone", () => {
    const resolved = ambient();
    assert.equal(resolved.home, process.env["HOME"]);
    assert.equal(resolved.path, process.env["PATH"]);
    assert.equal(resolved.user, "someone");
  });
});

// A seat with no USER reports itself logged out, because claude resolves its
// macOS keychain credential by account name. A process started without the
// variable still has a passwd entry, so the name is read from there rather
// than dropped: dropping it is the failure this fallback exists to prevent.
test("a missing USER falls back to the passwd entry, never to nothing", () => {
  withEnv("USER", undefined, () => {
    assert.equal(ambient().user, userInfo().username);
  });
});

test("an empty USER is not a name either", () => {
  withEnv("USER", "", () => {
    assert.equal(ambient().user, userInfo().username);
  });
});

test("HOME and PATH are required, and the refusal says what they are for", () => {
  withEnv("HOME", undefined, () => {
    assert.throws(() => ambient(), /HOME and PATH must be set/u);
  });
});
