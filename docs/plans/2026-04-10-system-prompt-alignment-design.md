# System Prompt Alignment Design

> Date: 2026-04-10
> Status: Approved

## Overview

Align the SDK's system prompt implementation with official Claude Agent SDK documentation. Key changes:

1. Separate system prompt (base behavior) from environment prompt (tools, context, CLAUDE.md)
2. Support `'claude_code'` preset with full Claude Code instructions
3. Load CLAUDE.md files via `settingSources`

## Current vs Target Architecture

### Current (Mixed)

```
System Prompt = All-in-one (base + tools + env + context)
```

### Target (Layered)

```
System Prompt = Base Prompt (preset or custom)
                ↓
Environment Prompt = Tools + Skills + Context + CLAUDE.md (always appended)
```

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Preset values | `'default' \| 'claude_code'` | Align with official SDK |
| Default preset | `'default'` | Minimal, maintains current behavior |
| settingSources | Loads skills + CLAUDE.md | Extended existing behavior |
| Output styles | Not implemented | Deferred to future work |
| Implementation approach | Internal refactor (Option A) | API unchanged, clean separation |

## Components

### 1. Type Definitions

```typescript
// src/types.ts

export type SystemPromptPreset = 'default' | 'claude_code'

// AgentOptions.systemPrompt - unchanged signature, extended preset values
interface AgentOptions {
  systemPrompt?: string | { 
    type: 'preset'
    preset: SystemPromptPreset
    append?: string 
  }
  appendSystemPrompt?: string
  settingSources?: ('user' | 'project')[]
}
```

### 2. Preset Content

```typescript
// src/prompts/system-prompts.ts (new file)

export const SYSTEM_PROMPTS = {
  default: 'You are a helpful assistant.',
  
  claude_code: `## System Prompt

I am Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.
I am an interactive agent that helps users with software engineering tasks...

(Full content from provided prompt)
`
}
```

### 3. CLAUDE.md Loader

```typescript
// src/utils/claude-md.ts (new file)

export async function loadClaudeMd(
  cwd: string,
  settingSources?: ('user' | 'project')[]
): Promise<string | null>
```

**Loading order**:
- User-level: `~/.claude/CLAUDE.md` (if `settingSources.includes('user')`)
- Project-level: `cwd/.claude/CLAUDE.md` or `cwd/CLAUDE.md` (if `settingSources.includes('project')`)

Both are merged if present.

### 4. Environment Prompt Builder

Rename existing `buildSystemPrompt()` to `buildEnvironmentPrompt()`:

```typescript
// src/engine.ts

async function buildEnvironmentPrompt(config: QueryEngineConfig): Promise<string> {
  // Available Tools
  // Available Subagents
  // Available Skills
  // Environment (git status, etc.)
  // Project Context (AGENT.md)
  // Working Directory
  // CLAUDE.md Instructions (NEW)
}
```

### 5. Main Assembly

```typescript
// src/engine.ts

async function buildSystemPrompt(config: QueryEngineConfig): Promise<string> {
  const basePrompt = config.systemPrompt || SYSTEM_PROMPTS.default
  const envPrompt = await buildEnvironmentPrompt(config)
  
  let result = basePrompt + '\n\n' + envPrompt
  if (config.appendSystemPrompt) {
    result += '\n\n' + config.appendSystemPrompt
  }
  
  return result
}
```

```typescript
// src/agent.ts - in Agent.prompt()

// Parse systemPrompt option
let systemPrompt: string | undefined
let appendSystemPrompt = opts.appendSystemPrompt || ''

if (opts.systemPrompt) {
  if (typeof opts.systemPrompt === 'object' && opts.systemPrompt.type === 'preset') {
    systemPrompt = SYSTEM_PROMPTS[opts.systemPrompt.preset]
    if (opts.systemPrompt.append) {
      appendSystemPrompt += '\n' + opts.systemPrompt.append
    }
  } else {
    systemPrompt = opts.systemPrompt as string
  }
} else {
  systemPrompt = SYSTEM_PROMPTS.default
}

// Pass to QueryEngine
const engine = new QueryEngine({
  systemPrompt,
  appendSystemPrompt,
  settingSources: opts.settingSources,
  // ...
})
```

## File Changes

| File | Action |
|------|--------|
| `src/types.ts` | Extend `SystemPromptPreset` type |
| `src/prompts/system-prompts.ts` | Create new file |
| `src/utils/claude-md.ts` | Create new file |
| `src/engine.ts` | Rename/refactor prompt builders |
| `src/agent.ts` | Update preset parsing logic |
| `examples/05-custom-system-prompt.ts` | Update example (optional) |

## Testing Strategy

1. Verify `default` preset produces minimal base + environment prompt
2. Verify `claude_code` preset produces full base + environment prompt
3. Verify custom string replaces base prompt entirely
4. Verify `settingSources: ['project']` loads project CLAUDE.md
5. Verify `settingSources: ['user']` loads user CLAUDE.md
6. Verify both sources combined
7. Verify `append` works with both presets

## Backwards Compatibility

- `systemPrompt: string` - unchanged (custom prompt)
- `systemPrompt: { type: 'preset', preset: 'default' }` - unchanged signature, content now minimal
- `appendSystemPrompt` - unchanged
- `settingSources` - extended semantics (loads CLAUDE.md additionally)

No breaking API changes.

## Future Work

- Output styles support (`~/.claude/output-styles/`)
- Additional presets (e.g., custom project presets)
- CLAUDE.md hot-reload for long-running sessions