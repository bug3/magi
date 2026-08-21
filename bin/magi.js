#!/usr/bin/env node
// Thin launcher: everything typed lives in src/cli.ts. From a clone Node runs
// it directly through type stripping, with no build step. An installed package
// cannot do that, because Node refuses to strip types under node_modules, so
// `npm run build` emits dist/ and the tarball ships that.
//
// The source wins where it exists. Preferring the build meant a clone silently
// ran whatever dist/ was left over from the last `npm run build`, so an edit
// under src/ appeared to do nothing and a stale build shipped its behaviour
// into a live consult. The tarball carries no src/, so an installed package is
// unaffected: `files` lists bin, dist and the data directories, never src.
import { existsSync } from "node:fs";

const source = new URL("../src/cli.ts", import.meta.url);
const entry = existsSync(source) ? source : new URL("../dist/cli.js", import.meta.url);
const { main } = await import(entry.href);

process.exitCode = await main(process.argv.slice(2));
