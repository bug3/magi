#!/usr/bin/env node
// Thin launcher: everything typed lives in src/cli.ts. From a clone Node runs
// it directly through type stripping, with no build step. An installed package
// cannot do that, because Node refuses to strip types under node_modules, so
// `npm run build` emits dist/ and the tarball ships that. Prefer the build
// when it is there, fall back to the source when it is not.
import { existsSync } from "node:fs";

const built = new URL("../dist/cli.js", import.meta.url);
const entry = existsSync(built) ? built : new URL("../src/cli.ts", import.meta.url);
const { main } = await import(entry.href);

process.exitCode = await main(process.argv.slice(2));
