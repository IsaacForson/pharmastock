// Lets plain Node scripts (tsx) import app modules guarded by `import "server-only"`: that package throws outside the
// react-server condition, and scripts are trusted server code. Must be imported before any app module.
import Module from "node:module";
import path from "node:path";

const empty = path.resolve(import.meta.dirname, "../../src/test/empty.ts");
const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = (req, ...rest) => (req === "server-only" ? empty : orig(req, ...rest));
