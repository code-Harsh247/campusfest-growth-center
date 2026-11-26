import path from "node:path";
import type { NextConfig } from "next";

const root = path.resolve(".");

const config: NextConfig = {
  output: "standalone",
  // Pin the project root: a stray lockfile higher up would otherwise be taken as the root.
  turbopack: { root },
  outputFileTracingRoot: root,
  // PGlite ships WebAssembly: load it (and pg) from node_modules, unbundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // The SQL files and the dataset snapshot are read at runtime from the project root.
  outputFileTracingIncludes: { "/**": ["./db/**", "./data/attendee-dataset.json"] },
};

export default config;
