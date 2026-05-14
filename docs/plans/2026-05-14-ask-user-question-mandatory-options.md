# AskUserQuestion 强制选项模式实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 AskUserQuestion 工具的 options 参数从可选改为必填，强制要求至少 2 个选项。

**Architecture:** 修改 JSON Schema 定义和 TypeScript 类型签名，在 schema 层面强制约束，无运行时校验。

**Tech Stack:** TypeScript, JSON Schema

---

### Task 1: 更新 AskUserQuestion schema 定义

**Files:**
- Modify: `src/tools/ask-user.ts:45-60`

**Step 1: 修改 inputSchema，将 options 设为必填并添加 minItems 约束**

修改 `inputSchema` 对象：

```typescript
inputSchema: {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'The question to ask the user. For interactive Q&A, this is the single current question (not all questions at once).' },
    options: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      description: 'Required choices for the user to select from. Must provide at least 2 options.',
    },
    allow_multiselect: {
      type: 'boolean',
      description: 'Whether to allow multiple selections (for options)',
    },
  },
  required: ['question', 'options'],
},
```

**Step 2: 运行 TypeScript 编译验证**

Run: `npm run build`
Expected: 编译成功，无类型错误

---

### Task 2: 更新 setQuestionHandler 函数签名

**Files:**
- Modify: `src/tools/ask-user.ts:12,17-20`

**Step 1: 更新 questionHandler 类型声明**

修改第 12 行：

```typescript
let questionHandler: ((question: string, options: string[]) => Promise<string>) | null = null
```

**Step 2: 更新 setQuestionHandler 函数签名**

修改第 17-20 行：

```typescript
export function setQuestionHandler(
  handler: (question: string, options: string[]) => Promise<string>,
): void {
  questionHandler = handler
}
```

**Step 3: 运行 TypeScript 编译验证**

Run: `npm run build`
Expected: 编译成功，无类型错误

---

### Task 3: 更新 call 函数中的非交互模式返回

**Files:**
- Modify: `src/tools/ask-user.ts:84-89`

**Step 1: 简化非交互模式返回，移除 options 条件判断**

修改第 84-89 行：

```typescript
// Non-interactive: return informative message
return {
  type: 'tool_result',
  tool_use_id: '',
  content: `[Non-interactive mode] Question: ${input.question}\nOptions: ${input.options.join(', ')}\n\nNo user available to answer. Proceeding with best judgment.`,
}
```

**Step 2: 运行 TypeScript 编译验证**

Run: `npm run build`
Expected: 编译成功，无类型错误

---

### Task 4: 更新工具描述

**Files:**
- Modify: `src/tools/ask-user.ts:32-44`

**Step 1: 更新 description，强调选项必填**

修改第 32-44 行：

```typescript
description: `Ask the user a question with required choices. Displays a structured popup with choices for the user to select from.

Suitable scenarios:
- User needs to choose from multiple options (e.g., plan selection, file selection)
- Explicit confirmation before high-risk operations
- User instruction is ambiguous and needs clarification
- Interactive Q&A: personality tests, surveys, story interactions where you need per-question feedback

Requirements:
- MUST provide at least 2 options for the user to choose from
- Call AskUserQuestion once per question — show only the current question
- After the user answers, determine the next question based on their response
- Progress step by step until all questions are completed
- Do NOT list all questions in plain text — use multiple AskUserQuestion calls to unfold them one by one`,
```

**Step 2: 运行 TypeScript 编译验证**

Run: `npm run build`
Expected: 编译成功，无类型错误

---

### Task 5: 最终验证和提交

**Step 1: 运行完整构建**

Run: `npm run build`
Expected: 编译成功，生成 dist 目录

**Step 2: 检查类型定义**

Run: `npx tsc --noEmit`
Expected: 无类型错误

**Step 3: 提交更改**

```bash
git add src/tools/ask-user.ts
git commit -m "feat(AskUserQuestion): make options required with minimum 2 items

BREAKING CHANGE: options parameter is now required with minimum 2 items.
Callers must update to provide options array."
```