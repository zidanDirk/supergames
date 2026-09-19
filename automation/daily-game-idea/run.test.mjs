import assert from "node:assert/strict";
import test from "node:test";

import {
  findSimilarIssue,
  parseRepository,
  titleSimilarity,
  todayInTimeZone,
  unwrapClaudeOutput,
  validateIdea,
} from "./run.mjs";

const headings = [
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

test("uses the configured time zone for the daily key", () => {
  const instant = new Date("2026-09-18T16:30:00.000Z");
  assert.equal(todayInTimeZone("Asia/Shanghai", instant), "2026-09-19");
  assert.equal(todayInTimeZone("UTC", instant), "2026-09-18");
});

test("validates repository names", () => {
  assert.deepEqual(parseRepository("zidanDirk/supergames"), {
    owner: "zidanDirk",
    repo: "supergames",
  });
  assert.throws(() => parseRepository("not-a-repository"), /owner\/repo/);
});

test("unwraps JSON returned by Claude Code", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    result: '```json\n{"title":"demo","body":"content"}\n```',
  });
  assert.deepEqual(unwrapClaudeOutput(stdout), { title: "demo", body: "content" });
});

test("rejects an incomplete issue and accepts a complete one", () => {
  assert.throws(
    () => validateIdea({ title: "[Game Idea] 太短", body: "内容" }),
    /标题格式|正文长度/,
  );

  const body = `${headings.map((heading) => `## ${heading}\n具体设计说明。`).join("\n\n")}
### MVP
基础版本。
### 打磨项
反馈增强。
### 暂不实现
联网排行。
${Array.from({ length: 8 }, (_, index) => `- [ ] 验收项目 ${index + 1}`).join("\n")}
${"玩法细节与可测试的规则。".repeat(100)}
https://example.com/a https://example.org/b https://example.net/c`;
  const idea = validateIdea({
    title: "[Game Idea] 光影织路 — 用影子搭出不断崩塌的逃生路线",
    body,
  });
  assert.match(idea.title, /^\[Game Idea\]/);
});

test("detects near-duplicate idea titles", () => {
  const existing = [
    { number: 12, title: "[Game Idea] 光影织路 — 用影子搭出逃生路线" },
    { number: 13, title: "[Game Idea] 节奏农场 — 跟随鼓点收割" },
  ];
  assert.ok(
    titleSimilarity(
      "[Game Idea] 光影织路：用影子搭出不断崩塌的逃生路线",
      existing[0].title,
    ) > 0.56,
  );
  assert.equal(
    findSimilarIssue("[Game Idea] 光影织路：用影子搭出不断崩塌的逃生路线", existing)?.number,
    12,
  );
});
