/**
 * YAML Frontmatter Parser for SKILL.md files
 * 
 * Lightweight parser without external dependencies.
 */

export interface Frontmatter {
  name?: string
  description: string
  model?: string
  allowedTools?: string[]
  userInvocable?: boolean
}

/**
 * Parse a SKILL.md file content into frontmatter and body.
 * 
 * @param content - Raw SKILL.md content
 * @returns Parsed frontmatter and body
 */
export function parseSkillMarkdown(content: string): {
  frontmatter: Frontmatter
  body: string
} {
  // Match YAML frontmatter between --- delimiters
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing frontmatter')
  }

  const frontmatterStr = match[1]
  const body = match[2]

  const frontmatter = parseYamlFrontmatter(frontmatterStr)

  if (!frontmatter.description) {
    throw new Error('SKILL.md must have a description field')
  }

  return { frontmatter, body }
}

/**
 * Lightweight YAML parser for frontmatter fields.
 * Only supports basic types: string, array, boolean.
 */
function parseYamlFrontmatter(yaml: string): Frontmatter {
  const lines = yaml.split('\n')
  const result: Record<string, any> = {}
  let currentArray: string[] | null = null
  let currentArrayKey: string | null = null

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) {
      continue
    }

    // Array item
    if (line.startsWith('  - ')) {
      if (currentArrayKey && currentArray !== null) {
        currentArray.push(line.trim().substring(2))
      }
      continue
    }

    // Key-value pair
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.substring(0, colonIndex).trim()
    const value = line.substring(colonIndex + 1).trim()

    // Close previous array
    currentArray = null
    currentArrayKey = null

    // Parse value
    if (value === '') {
      // Array start
      currentArray = []
      result[key] = currentArray
      currentArrayKey = key
    } else if (value === 'true') {
      result[key] = true
    } else if (value === 'false') {
      result[key] = false
    } else {
      result[key] = value
    }
  }

  // Map to Frontmatter interface
  const frontmatter: Frontmatter = {
    description: result.description || '',
  }

  if (result.name) frontmatter.name = String(result.name)
  if (result.model) frontmatter.model = String(result.model)
  if (result['allowed-tools']) {
    frontmatter.allowedTools = (result['allowed-tools'] as string[]).map(s => String(s))
  }
  if (result['user-invocable'] !== undefined) {
    frontmatter.userInvocable = Boolean(result['user-invocable'])
  }

  return frontmatter
}