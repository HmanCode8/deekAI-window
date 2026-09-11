/**
 * 打包前生成「发行内置配置」build/app-config.json。
 *
 * 用法：
 *   node scripts/prepare-release-config.mjs --edition=release
 *   node scripts/prepare-release-config.mjs --edition=advanced
 *
 * 规则：
 * - 源文件：release 读 app-config.json；advanced 优先读 app-config.advanced.json，其次 app-config.json
 * - 缺失源文件时生成最小配置（仅版本标记），保证打包不中断
 * - 强制写入 DEEKAI_EDITION，避免忘记设置导致把内部配置暴露给普通用户
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");

const editionArg = process.argv
  .find((arg) => arg.startsWith("--edition="))
  ?.split("=")[1];
const edition = editionArg === "advanced" ? "advanced" : "release";

const candidates =
  edition === "advanced"
    ? ["app-config.advanced.json", "app-config.json"]
    : ["app-config.json"];

let config = {};
let sourceFile = "(无，使用最小配置)";

for (const name of candidates) {
  const file = path.join(root, name);
  try {
    if (!fs.existsSync(file)) continue;
    config = JSON.parse(fs.readFileSync(file, "utf-8"));
    sourceFile = name;
    break;
  } catch (err) {
    console.warn(`[prepare-release-config] 解析 ${name} 失败，已跳过：`, err.message);
  }
}

config.DEEKAI_EDITION = edition;

fs.mkdirSync(buildDir, { recursive: true });
const outFile = path.join(buildDir, "app-config.json");
fs.writeFileSync(outFile, JSON.stringify(config, null, 2), "utf-8");

console.log(
  `[prepare-release-config] edition=${edition} · 来源=${sourceFile} · 输出=${path.relative(
    root,
    outFile
  )}`
);

if (edition === "release" && (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY)) {
  console.warn(
    "[prepare-release-config] 警告：release 版缺少 SUPABASE_URL / SUPABASE_ANON_KEY，" +
      "普通用户将无法登录与持久化（仅能内存模式试用）。请在 app-config.json 中补齐后重新打包。"
  );
}
