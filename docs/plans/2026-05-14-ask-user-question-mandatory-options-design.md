# AskUserQuestion 强制选项模式设计

## 背景

当前 AskUserQuestion 工具的 `options` 参数是可选的，允许 AI 在不提供选项的情况下向用户提问。这导致 AI 可能过度频繁地使用开放式提问，增加了不必要的用户交互。

## 目标

- 删除开放式输入模式，强制要求提供选项
- 减少 AI 的不必要提问行为
- 统一交互模式，简化流程

## 设计决策

### 方案选择

采用 **JSON Schema 层面强制** 方案：
- 在 schema 层面将 `options` 设为必填字段
- 添加 `minItems: 2` 约束，要求至少 2 个选项
- 更新描述信息，强调必须提供选项

### 选择理由

1. 最简洁直接，SDK 层面直接拒绝无效调用
2. 符合 JSON Schema 标准，AI 可以从 schema 直接理解约束
3. 无额外运行时开销
4. 错误信息由框架生成，符合"schema 即文档"原则

## 实现细节

### 文件修改

**文件：** `src/tools/ask-user.ts`

### Schema 变更

```typescript
// 之前
inputSchema: {
  type: 'object',
  properties: {
    question: { type: 'string', description: '...' },
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional choices...',
    },
    allow_multiselect: { type: 'boolean', description: '...' },
  },
  required: ['question'],
}

// 之后
inputSchema: {
  type: 'object',
  properties: {
    question: { type: 'string', description: '...' },
    options: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      description: 'Required choices for the user to select from. Minimum 2 options.',
    },
    allow_multiselect: { type: 'boolean', description: '...' },
  },
  required: ['question', 'options'],
}
```

### Handler 签名更新

```typescript
// 之前
export function setQuestionHandler(
  handler: (question: string, options?: string[]) => Promise<string>,
): void

// 之后
export function setQuestionHandler(
  handler: (question: string, options: string[]) => Promise<string>,
): void
```

### 描述更新

1. 移除 `description` 中的 "Optional" 相关描述
2. 强调必须提供至少 2 个选项
3. 更新工具描述中的适用场景，移除开放式问答相关内容
4. 非交互模式返回中移除 `input.options ?` 的条件判断（因为 options 必定存在）

## 破坏性变更

- 现有代码中不带 `options` 的调用将失败
- 不提供向后兼容
- 消费方需要更新代码以适配新接口

## 影响范围

1. `src/tools/ask-user.ts` - 主要修改文件
2. 使用 `setQuestionHandler` 的代码需要更新 handler 签名
3. 文档需要更新，说明 options 为必填

## 验证方式

1. 单元测试验证 schema 校验生效
2. 测试少於 2 个选项时返回错误
3. 测试正常调用流程