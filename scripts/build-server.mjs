/**
 * 打包网页端能力服务（Node）：
 * 只打包自有源码，第三方依赖（express/multer/pdf-parse/mammoth 等）保持 external，
 * 运行时从 node_modules 加载（部署时 `npm ci --omit=dev`）。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const external = [
  "express",
  "multer",
  "pdf-parse",
  "mammoth",
  "dotenv",
  "@supabase/supabase-js",
];

await build({
  entryPoints: [path.join(root, "src/server/index.ts")],
  outfile: path.join(root, "out/server/index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  alias: {
    "@shared": path.join(root, "src/shared"),
  },
  external,
  logLevel: "info",
});
