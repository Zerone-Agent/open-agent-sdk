/**
 * Skills Module - Public API
 */

// Types
export type {
  SkillDefinition,
  SkillContentBlock,
  SkillResult,
} from './types.js'

// Registry
export {
  registerSkill,
  getSkill,
  getAllSkills,
  getUserInvocableSkills,
  hasSkill,
  unregisterSkill,
  clearSkills,
  formatSkillsForPrompt,
  formatSkillsForSystemPrompt,
  formatSkillsForToolDescription,
} from './registry.js'

// Bundled skills
export { initBundledSkills } from './bundled/index.js'

// Filesystem loading
export { loadSkillsFromFilesystem } from './filesystem.js'
