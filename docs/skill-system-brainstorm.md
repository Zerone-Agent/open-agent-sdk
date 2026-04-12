# Skill 系统完善方案 Brainstorm

> 参考来源：opencode `specs/skill-implementation.md`
> 日期：2026-04-11

---

## 现状评估

### 已有基础（扎实）

| 模块 | 状态 |
|------|------|
| `SkillDefinition` 类型 | 完整，含 name/description/allowedTools/model/context/hooks 等字段 |
| Skill Registry | 已实现注册、查找、别名解析 |
| YAML 文件加载 | `filesystem.ts` + `yaml.ts` 已可用 |
| 5 个内置 Skill | simplify、commit、review、debug、test |
| `SkillTool` | 已作为 model-facing 工具存在 |
| 系统提示词注入 | `formatSkillsForPrompt()` 基础版已有 |

---

## 10 个关键 Gap 分析

### Gap 1: `allowedTools` 只是文字，引擎不执行

**问题**：技能声明的工具限制完全无效，LLM 拿到文字说明但引擎仍提供所有工具。

**方案**：
- A. 引擎检测 Skill 调用结果，临时过滤 `config.tools`（scoped tool list）
- B. `context: 'fork'` 技能走子 Agent，子 Agent 只初始化 `allowedTools` 指定的工具 **← 推荐**
- C. 在 `SkillTool.call()` 中返回结构化信号，让引擎层解释

**推荐**：B 方案最干净 —— `fork` 类型技能本来就应该走子 Agent，子 Agent 天然支持工具隔离。`inline` 技能保持 advisory only，`fork` 技能才严格执行。

---

### Gap 2: `context: 'fork'` 完全没有实现

**问题**：类型有，代码没有。`SkillTool.call()` 只是把 `status: 'forked'` 塞进 JSON。

**方案**：`fork` 技能 → `SkillTool.call()` 内部 `new QueryEngine(...)` 创建子 Agent，子 Agent 使用技能的 `model`、`allowedTools`、`hooks`，输出 stream 回传到父 Agent 的工具结果。

这是最有价值的功能升级，让技能真正成为"专家代理"。

---

### Gap 3: 技能发现路径太窄

**当前**：只扫描 `~/.claude/skills/` 和 `{cwd}/.claude/skills/`。

**OpenCode 的多路径策略**：
```
.opencode/skills/        → 项目专用（推荐）
.claude/skills/          → Claude Code 兼容
.agents/skills/          → 通用 Agent 兼容
~/.config/opencode/      → 全局用户技能
```

加上配置文件自定义路径 + 远程 URL 下载。

**建议**：扩展 `filesystem.ts` 扫描路径，加入 `.opencode/skills/`，并沿 git 根目录向上遍历。

---

### Gap 4: 两层注入策略没有落实 ← **当前工作项**

**OpenCode 的洞察**：
> "the agents seem to ingest the information about skills a bit better if we present a more verbose version of them here and a less verbose version in tool description"

| 层级 | 位置 | 格式 | 作用 |
|------|------|------|------|
| 系统提示词 | System Prompt | Verbose XML | 建立完整认知框架（含 location） |
| Tool 描述 | Tool Definition | 简洁 Markdown | 快速匹配，便于决策 |

**当前**：`formatSkillsForPrompt()` 只生成一种格式，SkillTool 输出也只是 JSON。

**实现**：
1. 系统提示词用 `<available_skills><skill><name>...</name><description>...</description><location>...</location></skill></available_skills>` XML
2. Tool description 用简洁 `## Available Skills\n- **name**: description`
3. SkillTool 调用结果用 `<skill_content>` XML（含 base directory + skill files 列表）

**SkillTool 调用输出格式**（对标 OpenCode）：
```xml
<skill_content name="agents-sdk">
# Skill: agents-sdk

[SKILL.md 完整内容]

Base directory for this skill: file:///Users/.claude/skills/agents-sdk/
Relative paths in this skill are relative to this base directory.
Note: file list is sampled.

<skill_files>
<file>/Users/.claude/skills/agents-sdk/references/callable.md</file>
<file>/Users/.claude/skills/agents-sdk/references/workflows.md</file>
</skill_files>
</skill_content>
```

---

### Gap 5: 用户 `/command` 调用没有实现

**当前**：`userInvocable` 字段存在但无人消费。

**方案**：
- A. `Agent.query()` 前解析输入，检测 `/skillname args` 模式，自动注入调用提示 **← 推荐**
- B. 完全依赖 LLM 从系统提示词自主判断
- C. `/skill skillname args` 前缀，agent.ts 层拦截

---

### Gap 6: 远程 URL 技能分发

OpenCode 的 `skills.urls` 配置 + `index.json` + 并发下载 + 本地缓存。

项目完全没有。优先级低，但对团队/企业场景有价值。

---

### Gap 7: `argumentHint` 从未使用

在 `formatSkillsForPrompt()` 加一行即可：
```
- **commit** (args: `<message? or 'auto'>`): Create a git commit...
```

---

### Gap 8: Image 内容块被丢弃

`SkillTool.call()` 过滤掉 `type: 'image'` 的内容块。

**修复**：将图片块转换为 Anthropic API 的 image content blocks 返回。

---

### Gap 9: 无冲突检测和版本管理

技能重名时 last-write-wins，无警告。

**建议**：`registerSkill()` 加重复检测，按优先级（project > global > bundled）决定覆盖策略。

---

### Gap 10: `SkillResult` 类型没有被实际使用

类型声明和运行时字段名不一致（`skillName` vs `commandName`）。

**修复**：统一 `SkillTool.call()` 返回 `SkillResult` 结构。

---

## 优先级路线图

| 优先级 | Gap | 价值 | 成本 |
|--------|-----|------|------|
| P0 | Gap 4: 两层注入 + `<skill_content>` 输出格式 | 直接提升 LLM 技能选择准确率 | 低 |
| P0 | Gap 2: `fork` 子 Agent 实现 | 技能成为真正专家代理 | 高 |
| P1 | Gap 1: `allowedTools` 执行（随 Gap2）| 工具安全隔离 | 中 |
| P1 | Gap 3: 多路径技能发现 | 兼容性和 DX | 低 |
| P1 | Gap 5: `/command` 用户调用 | DX 关键功能 | 低 |
| P2 | Gap 6: 远程 URL 分发 | 团队共享 | 高 |
| P2 | Gap 7: argumentHint 展示 | 一行修复 | 极低 |
| P3 | Gap 8: 图片块支持 | 场景有限 | 中 |
| P3 | Gap 9: 冲突检测 | 稳健性 | 低 |
| P3 | Gap 10: SkillResult 类型统一 | 技术债 | 低 |
