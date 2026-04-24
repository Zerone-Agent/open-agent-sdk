# AskUserQuestion Tool Test Suite

## 测试文件

- `test-ask-user-question.ts` - AskUserQuestion 工具修复验证测试

## 运行方式

### 方法 1: 使用 tsx（推荐）

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npx tsx examples/test-ask-user-question.ts
```

### 方法 2: 使用 node --loader（如果安装了 ts-node）

```bash
cd X:\Yi-one\open-agent-sdk-typescript
node --loader ts-node/esm examples/test-ask-user-question.ts
```

### 方法 3: 先编译再运行

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npm run build
node dist/examples/test-ask-user-question.js
```

## 测试内容

### Test 1: Tool Properties
验证 `isReadOnly: false` 和 `isConcurrencySafe: false` 是否正确设置。

**预期结果**: 工具配置为串行执行，防止并发冲突。

### Test 2: toolUseId in Context
验证 `toolUseId` 是否正确通过 `ToolContext` 传递给工具。

**预期结果**: `result.tool_use_id` 应该与传入的 `context.toolUseId` 一致。

### Test 3: Question Handler Timeout
验证问题处理器的超时机制（5分钟）。

**预期结果**: 测试在1秒后超时，实际生产环境等待5分钟。

### Test 4: Basic Question (No Options)
测试不带选项的基本问题。

**预期结果**: 用户可以输入任意文本回答。

### Test 5: Question with Options
测试带选项的多选题。

**预期结果**: 用户可以选择预定义的选项之一。

### Test 6: Non-Interactive Mode
验证当没有设置 handler 时的非交互模式。

**预期结果**: 返回包含 "Non-interactive mode" 的提示信息。

### Test 7: Concurrent Safety
验证并发安全性（由于 `isReadOnly: false`，实际是串行执行）。

**预期结果**: 两个问题按顺序处理，不会产生竞态条件。

## 修复的 Bug

1. **✅ 并发执行冲突**: `isReadOnly: () => false` 强制串行执行
2. **✅ Tool ID 丢失**: 通过 `ToolContext.toolUseId` 正确传递
3. **✅ 超时机制**: 5分钟超时防止永久等待
4. **✅ 顺序保证**: 串行执行确保多个问题不会相互干扰

## 期望输出

```
══════════════════════════════════════════════════════════════════════
  AskUserQuestion Tool - Bug Fix Verification Tests
══════════════════════════════════════════════════════════════════════
Test 1: Verifying tool properties...
  ✅ PASSED: Tool properties are correct
     - isReadOnly: false (sequential execution)
     - isConcurrencySafe: false (not safe for concurrent calls)

Test 2: Verifying toolUseId is passed in context...
  ✅ PASSED: toolUseId is correctly passed
     - Received tool_use_id: test-tool-use-id-12345

Test 3: Verifying question handler timeout...
  ⏱️  NOTE: Tool waits for user input (5 min timeout)
     (Test timeout after 1s to avoid long wait)
  ✅ PASSED: Timeout mechanism works (5 minutes in production)

Test 4: Verifying basic question without options...
  ✅ PASSED: Basic question works
     - Question: What is your name?
     - Answer: user-typed-answer

Test 5: Verifying question with options...
  ✅ PASSED: Question with options works
     - Question: Which option do you prefer?
     - Options: Option A, Option B, Option C
     - Selected: Option A

Test 6: Verifying non-interactive mode...
  ✅ PASSED: Non-interactive mode works
     - Returns informative message
     - tool_use_id is preserved

Test 7: Verifying concurrent safety (isReadOnly: false)...
  ✅ PASSED: Sequential execution prevents conflicts
     - Question 1 processed first
     - Question 2 processed second
     - No race condition due to isReadOnly: false

══════════════════════════════════════════════════════════════════════
  Test Summary
══════════════════════════════════════════════════════════════════════
  ✅ All 7 tests passed!

  Bug fixes verified:
    1. ✅ isReadOnly: false (prevents concurrent execution)
    2. ✅ toolUseId is correctly passed in ToolContext
    3. ✅ questionHandler timeout mechanism works
    4. ✅ Sequential execution prevents conflicts
    5. ✅ Non-interactive mode preserved for fallback

══════════════════════════════════════════════════════════════════════
```

## 故障排除

### Error: Cannot find module
确保你在 SDK 根目录运行命令：
```bash
cd X:\Yi-one\open-agent-sdk-typescript
npx tsx examples/test-ask-user-question.ts
```

### Error: tsc not found
安装 TypeScript：
```bash
npm install -g typescript
```

### Error: tsx not found
安装 tsx：
```bash
npm install -g tsx
```

## 下一步

测试通过后，可以：
1. 在 client 中集成（agent-client.ts 已修改）
2. 启动 client 进行端到端测试
3. 在实际对话中测试 AskUserQuestion 工具
