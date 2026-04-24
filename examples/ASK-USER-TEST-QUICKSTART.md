# AskUserQuestion 修复测试 - 快速开始

## 运行测试

### 方法 1: 使用 npm 脚本（推荐）

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npm run test:ask-user
```

### 方法 2: 直接使用 tsx

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npx tsx examples/test-ask-user-question.ts
```

### 方法 3: 运行所有测试

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npm run test:all
```

## 测试输出示例

成功运行的输出应该像这样：

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

...

══════════════════════════════════════════════════════════════════════
  Test Summary
══════════════════════════════════════════════════════════════════════
  ✅ All 7 tests passed!
```

## 如果测试失败

### 检查 1: 确保 tsx 已安装

```bash
cd X:\Yi-one\open-agent-sdk-typescript
npm install
```

### 检查 2: 确保在正确目录

```bash
# 确认你在 SDK 根目录
pwd
# 应该显示: X:\Yi-one\open-agent-sdk-typescript
```

### 检查 3: 检查 TypeScript 编译

```bash
npm run build
```

如果编译失败，说明代码有错误。

## 修复的内容

运行测试将验证以下修复：

1. ✅ **isReadOnly: false** - 防止并发冲突
2. ✅ **toolUseId 传递** - 修复 tool_use_id 为空字符串的问题
3. ✅ **超时机制** - 5分钟超时防止永久等待
4. ✅ **串行执行** - 确保多个问题按顺序处理
5. ✅ **非交互模式** - 没有 handler 时优雅降级

## 下一步

测试通过后，在 client 中运行：

```bash
cd X:\Yi-one\client
npm run dev
```

然后在聊天中测试实际的 AskUserQuestion 功能。
