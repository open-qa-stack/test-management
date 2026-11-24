import { takeCoverage } from "node:v8";
import { afterAll } from "vitest";

// The process of a test file is stopped before Node.js writes what it covered: it is written here, once its tests are over.
afterAll(() => takeCoverage());
