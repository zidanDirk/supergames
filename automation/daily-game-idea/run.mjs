#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY = "zidanDirk/supergames";
const DAILY_MARKER_PREFIX = "daily-game-idea:";

export function todayInTimeZone(timeZone = "Asia/Shanghai", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseRepository(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value ?? "");
  if (!match) {
    throw new Error(`GITHUB_REPOSITORY 必须是 owner/repo 格式，当前值：${value}`);
  }
  return { owner: match[1], repo: match[2] };
}

export function unwrapClaudeOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Claude Code 没有返回合法的 JSON 包装：${error.message}`);
  }

  if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
    throw new Error(`Claude Code 执行失败：${envelope.result || envelope.subtype || "未知错误"}`);
  }

  const content = typeof envelope.result === "string" ? envelope.result.trim() : envelope.result;
  if (content && typeof content === "object") return content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Claude Code 返回中缺少 result 字段");
  }

  const withoutFence = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("模型结果中没有找到游戏创意 JSON");
    }
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch (error) {
      throw new Error(`模型返回的游戏创意不是合法 JSON：${error.message}`);
    }
  }
}

export function validateIdea(idea) {
  if (!idea || typeof idea !== "object" || Array.isArray(idea)) {
    throw new Error("游戏创意必须是 JSON 对象");
  }
  if (
    typeof idea.title !== "string" ||
    !/^\[Game Idea\]\s+.{2,40}\s+—\s+.{4,60}$/u.test(idea.title.trim())
  ) {
    throw new Error("Issue 标题格式不符合要求");
  }
  if (typeof idea.body !== "string" || idea.body.length < 1200 || idea.body.length > 18000) {
    throw new Error(`Issue 正文长度异常：${idea.body?.length ?? 0}`);
  }

  const requiredHeadings = [
    "一句话概念",
    "为什么值得做",
    "核心玩法",
    "3D 体验设计",
    "单局循环",
    "操作与反馈",
    "深度与重玩性",
    "美术与声音方向",
    "Codex 实现建议",
    "实现范围",
    "验收标准",
    "风险与降级方案",
    "参考来源",
  ];
  const missing = requiredHeadings.filter((heading) => !idea.body.includes(`## ${heading}`));
  if (missing.length > 0) {
    throw new Error(`Issue 正文缺少章节：${missing.join("、")}`);
  }

  const requiredSubheadings = ["MVP", "打磨项", "暂不实现"];
  const missingSubheadings = requiredSubheadings.filter(
    (heading) => !idea.body.includes(`### ${heading}`),
  );
  if (missingSubheadings.length > 0) {
    throw new Error(`Issue 正文缺少实现范围子章节：${missingSubheadings.join("、")}`);
  }

  const acceptanceItems = idea.body.match(/^\s*- \[[ xX]\]\s+.+$/gm) ?? [];
  if (acceptanceItems.length < 8) {
    throw new Error(`验收标准不足 8 条：当前 ${acceptanceItems.length} 条`);
  }

  const sourceUrls = idea.body.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  if (new Set(sourceUrls).size < 3) {
    throw new Error("Issue 至少需要 3 个不同的参考来源 URL");
  }

  return { title: idea.title.trim(), body: idea.body.trim() };
}

function normalizeTitle(title) {
  return title
    .replace(/^\[Game Idea\]\s*/iu, "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function bigrams(value) {
  const chars = [...value];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(0, -1).map((char, index) => char + chars[index + 1]));
}

export function titleSimilarity(left, right) {
  const a = bigrams(normalizeTitle(left));
  const b = bigrams(normalizeTitle(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function findSimilarIssue(title, issues, threshold = 0.56) {
  return issues.find((issue) => titleSimilarity(title, issue.title) >= threshold);
}

async function githubRequest(endpoint, { token, method = "GET", body } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "supergames-daily-game-idea",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = typeof data === "object" ? data?.message : data;
    throw new Error(`GitHub API ${method} ${endpoint} 失败 (${response.status})：${detail || "未知错误"}`);
  }
  return data;
}

async function listIssues(owner, repo, token) {
  const data = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=all&per_page=100&sort=created&direction=desc`,
    { token },
  );
  return data.filter((issue) => !issue.pull_request);
}

async function getExistingLabels(owner, repo, token) {
  const labels = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?per_page=100`,
    { token },
  );
  return new Set(labels.map((label) => label.name));
}

function renderPrompt(template, { today, repository, issues }) {
  const history = issues.length
    ? issues.map((issue) => `- #${issue.number} ${issue.title}（${issue.state}）`).join("\n")
    : "- 暂无历史 Issue";
  return template
    .replaceAll("{{TODAY}}", today)
    .replaceAll("{{REPOSITORY}}", repository)
    .replaceAll("{{EXISTING_ISSUES}}", history);
}

async function runClaude(prompt, env) {
  const claudeBin = env.CLAUDE_BIN || "claude";
  // DeepSeek 对外的稳定模型名；当前对应 DeepSeek V4.1 Flash。
  const model = env.DEEPSEEK_MODEL || "deepseek-flash";
  const timeoutMs = Number(env.CLAUDE_TIMEOUT_MS || 2_700_000);
  const args = [
    "-p",
    "--model",
    model,
    "--effort",
    env.DEEPSEEK_EFFORT || "max",
    "--output-format",
    "json",
    "--tools",
    "WebSearch,WebFetch",
    "--allowedTools",
    "WebSearch,WebFetch",
    "--disallowedTools",
    "mcp__*",
    "--max-turns",
    env.CLAUDE_MAX_TURNS || "30",
    "--no-session-persistence",
    prompt,
  ];

  const childEnv = {
    ...env,
    ANTHROPIC_BASE_URL: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: env.DEEPSEEK_API_KEY,
    ANTHROPIC_MODEL: model,
    CLAUDE_CODE_EFFORT_LEVEL: env.DEEPSEEK_EFFORT || "max",
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
  };
  delete childEnv.ANTHROPIC_API_KEY;

  return await new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      cwd: env.SUPERGAMES_REPO_DIR || path.resolve(SCRIPT_DIR, "../.."),
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const maxOutput = 20 * 1024 * 1024;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > maxOutput) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > maxOutput) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 Claude Code (${claudeBin})：${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Claude Code 异常退出（code=${code}, signal=${signal || "none"}）：${stderr.slice(-4000)}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  const env = process.env;
  if (!env.DEEPSEEK_API_KEY) throw new Error("缺少 DEEPSEEK_API_KEY");

  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const { owner, repo } = parseRepository(repository);
  const timeZone = env.TZ || "Asia/Shanghai";
  const today = todayInTimeZone(timeZone);
  const marker = `<!-- ${DAILY_MARKER_PREFIX}${today} -->`;
  const token = env.GITHUB_TOKEN;
  const dryRun = /^(1|true|yes)$/i.test(env.DRY_RUN || "");

  console.log(`[${new Date().toISOString()}] 开始生成 ${today} 的每日游戏创意`);
  const issues = await listIssues(owner, repo, token);
  if (issues.some((issue) => issue.body?.includes(marker))) {
    console.log(`${today} 已经创建过每日游戏创意 Issue，跳过本次运行。`);
    return;
  }

  const template = await readFile(path.join(SCRIPT_DIR, "prompt.md"), "utf8");
  const basePrompt = renderPrompt(template, { today, repository, issues });
  const maxAttempts = Math.max(1, Math.min(3, Number(env.GAME_IDEA_MAX_ATTEMPTS || 2)));
  let idea;
  let rejection = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retryInstruction = rejection
      ? `\n\n## 上一次结果未通过自动质检\n\n失败原因：${rejection}\n\n请重新联网研究并选择一个实质不同的创意，仍严格遵守最终 JSON 输出协议。`
      : "";
    try {
      const claudeOutput = await runClaude(basePrompt + retryInstruction, env);
      const candidate = validateIdea(unwrapClaudeOutput(claudeOutput));
      const similar = findSimilarIssue(candidate.title, issues);
      if (similar) {
        throw new Error(`与历史 Issue #${similar.number} 标题过于相似：${similar.title}`);
      }
      idea = candidate;
      break;
    } catch (error) {
      rejection = error.message;
      console.warn(`第 ${attempt}/${maxAttempts} 次生成未通过：${rejection}`);
    }
  }

  if (!idea) {
    throw new Error(`连续 ${maxAttempts} 次未能生成合格创意；最后错误：${rejection}`);
  }

  const body = `${idea.body}\n\n---\n${marker}\n> 由 Claude Code + DeepSeek 每日联网调研生成；实现前仍建议人工确认范围与版权风险。`;
  if (dryRun) {
    console.log("DRY_RUN 已启用，不会创建 GitHub Issue。\n");
    console.log(`# ${idea.title}\n\n${body}`);
    return;
  }
  if (!token) throw new Error("正式运行缺少 GITHUB_TOKEN（Fine-grained PAT，Issues: Read and write）");

  const requestedLabels = (env.GAME_IDEA_LABELS || "game-idea,daily-research")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const existingLabels = await getExistingLabels(owner, repo, token);
  const labels = requestedLabels.filter((label) => existingLabels.has(label));
  const skippedLabels = requestedLabels.filter((label) => !existingLabels.has(label));
  if (skippedLabels.length) {
    console.warn(`仓库中不存在以下标签，已跳过：${skippedLabels.join(", ")}`);
  }

  const created = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    { token, method: "POST", body: { title: idea.title, body, labels } },
  );
  console.log(`已创建 Issue #${created.number}: ${created.html_url}`);
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((error) => {
    console.error(`[${new Date().toISOString()}] 每日游戏创意任务失败：${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
