#!/usr/bin/env node
// Thin launcher: everything typed lives in src/cli.ts, which Node runs
// directly through type stripping (no build step).
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2));
