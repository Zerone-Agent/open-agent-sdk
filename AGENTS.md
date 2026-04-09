# AGENTS.md - Open Agent SDK (TypeScript)

> Guide for agentic coding assistants working in this repository.

## Project Overview

Open-source Agent SDK by CodeAny. Runs the full agent loop in-process — no local CLI required.
- 30+ built-in tools (file I/O, shell, web, agents, tasks, teams, etc.)
- MCP server integration (stdio, SSE, HTTP)
- Multi-provider support (Anthropic, OpenAI)

## Build Commands

```bash
# Build TypeScript to dist/
npm run build

# Watch mode for development
npm run dev

# Run single example (test entry point)
npm test

# Run all examples
npm run test:all

# Run specific example
npx tsx examples/01-simple-query.ts

# Web server example
npm run web
```

## Test Commands

This project uses `tsx` to run TypeScript examples directly (no formal test framework like Jest/Vitest).

```bash
# Run single example test
npx tsx examples/01-simple-query.ts

# Run all example tests
npm run test:all

# Run with environment variables
CODEANY_MODEL=claude-sonnet-4-6 npx tsx examples/01-simple-query.ts
```

## Streaming Output

Enable token-level streaming with `includePartialMessages: true`:

```typescript
const agent = createAgent({
  model: 'claude-sonnet-4-6',
  includePartialMessages: true,
})

for await (const event of agent.query('Hello')) {
  if (event.type === 'partial_message') {
    // Real-time text/thinking chunks
    process.stdout.write(event.partial.text || '')
  }
  if (event.type === 'assistant') {
    // Complete message (includes tool_use)
    console.log(event.message)
  }
}
```

Note: tool_use blocks are not streamed; they only appear in the complete `assistant` message.

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2022, Module: NodeNext, ModuleResolution: NodeNext
- Strict mode enabled
- Source maps and declarations generated

### Imports & Exports
- Use `.js` extension in imports (e.g., `import { foo } from './bar.js'`)
- Group imports: external deps → internal types → internal modules
- Prefer `import type` for type-only imports
- Named exports preferred over default exports

```typescript
// Good
import type { AgentOptions } from './types.js'
import { QueryEngine } from './engine.js'

// Export patterns used
export { Agent, createAgent, query } from './agent.js'
export type { AgentOptions, QueryResult } from './types.js'
```

### Naming Conventions
- `PascalCase`: Classes, interfaces, type aliases, enums (e.g., `QueryEngine`, `ToolDefinition`)
- `camelCase`: Functions, variables, properties (e.g., `createAgent`, `maxTurns`)
- `UPPER_SNAKE_CASE`: Constants (e.g., `DEFAULT_RETRY_CONFIG`)
- `PascalCase` with `Tool` suffix: Tool definitions (e.g., `FileReadTool`, `BashTool`)
- Private class members: prefix with `#` or use `private` keyword

### Types & Interfaces
- Prefer `interface` for object shapes that may be extended
- Prefer `type` for unions, tuples, and mapped types
- Explicit return types on exported functions
- Use `unknown` over `any` where possible

```typescript
export interface AgentOptions {
  model?: string
  maxTurns?: number
}

export type Message = UserMessage | AssistantMessage
```

### Error Handling
- Use try/catch with typed errors: `catch (err: any)`
- Return structured error results from tools:
  ```typescript
  return { data: 'Error message', is_error: true }
  ```
- Use utility functions from `utils/retry.ts` for retryable errors

### Tool Definition Pattern
All tools follow this structure:
```typescript
export const ToolName = defineTool({
  name: 'ToolName',
  description: 'Clear description of what the tool does',
  inputSchema: { /* JSON Schema */ },
  isReadOnly: true/false,
  isConcurrencySafe: true/false,
  async call(input, context) { /* implementation */ }
})
```

### File Organization
- Source code: `src/` (compiled to `dist/`)
- Examples: `examples/` (numbered examples, use `../src/index.js` imports)
- Utilities: `src/utils/`
- Tools: `src/tools/` (core file I/O, web, agent, task tools)
- Providers: `src/providers/` (Anthropic, OpenAI adapters)
- Skills: `src/skills/` (reusable prompt templates)
- MCP: `src/mcp/` (MCP client implementation)

### Documentation Style
- JSDoc comments at file level describing purpose
- Section dividers with `// ----------` for logical groupings
- Inline comments for complex logic

### Environment Variables
- `CODEANY_MODEL`: Default model (e.g., `claude-sonnet-4-6`)
- `CODEANY_API_KEY` / `OPENAI_API_KEY`: API credentials
- `CODEANY_BASE_URL`: Custom API endpoint

## Important Notes

- This is an ESM-only package (`"type": "module"`)
- Requires Node.js >= 18.0.0
- No linting (ESLint) or formatting (Prettier) configured — code style is manual
- Examples import from `../src/index.js` (not the package name)
