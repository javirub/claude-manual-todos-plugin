#!/usr/bin/env bun
/**
 * Entry point. It stays a launcher on purpose: ESM hoists every static import,
 * so the dependency check has to happen in a module that imports nothing before
 * the real server is pulled in dynamically.
 */
import { ensureDependencies } from "./preflight";

ensureDependencies();
await import("./main");
