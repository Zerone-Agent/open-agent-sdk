/**
 * Static Code Verification for AskUserQuestion Fixes
 * 
 * This script checks the source code directly without running it,
 * verifying that all the fixes are in place.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_DIR = 'src';

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function check(text, condition) {
  if (condition) {
    console.log(`${GREEN}✓${RESET} ${text}`);
    return true;
  } else {
    console.log(`${RED}✗${RESET} ${text}`);
    return false;
  }
}

function checkFileContent(filePath, description, checks) {
  console.log(`\n${YELLOW}Checking: ${filePath}${RESET}`);
  try {
    const content = readFileSync(join(SRC_DIR, filePath), 'utf-8');
    let allPassed = true;
    
    for (const { name, test } of checks) {
      const passed = test(content);
      check(name, passed);
      if (!passed) allPassed = false;
    }
    
    return allPassed;
  } catch (err) {
    console.log(`${RED}✗${RESET} Failed to read file: ${err.message}`);
    return false;
  }
}

console.log('='.repeat(70));
console.log('  AskUserQuestion Static Code Verification');
console.log('='.repeat(70));

let allTestsPassed = true;

// Test 1: Check ask-user.ts
allTestsPassed &= checkFileContent(
  'tools/ask-user.ts',
  'AskUserQuestion Tool Implementation',
  [
    { 
      name: 'isReadOnly returns false (prevents concurrent execution)',
      test: (c) => c.includes('isReadOnly: () => false')
    },
    { 
      name: 'isConcurrencySafe returns false',
      test: (c) => c.includes('isConcurrencySafe: () => false')
    },
    { 
      name: 'call method accepts context parameter',
      test: (c) => /async call\([^)]*context:\s*ToolContext/.test(c)
    },
    { 
      name: 'toolUseId is extracted from context',
      test: (c) => c.includes('context.toolUseId')
    },
    { 
      name: 'tool_use_id uses the extracted value',
      test: (c) => c.includes('tool_use_id: toolUseId') && c.includes('const toolUseId')
    },
    { 
      name: 'ToolContext is imported',
      test: (c) => c.includes('ToolContext') && c.includes('from')
    }
  ]
);

// Test 2: Check types.ts
allTestsPassed &= checkFileContent(
  'types.ts',
  'ToolContext Interface',
  [
    { 
      name: 'ToolContext has toolUseId field',
      test: (c) => /ToolContext[\s\S]*?toolUseId\?:\s*string/.test(c)
    }
  ]
);

// Test 3: Check engine.ts
allTestsPassed &= checkFileContent(
  'engine.ts',
  'Engine Context Creation',
  [
    { 
      name: 'makeContext includes toolUseId',
      test: (c) => c.includes('toolUseId: block.id')
    }
  ]
);

// Summary
console.log('\n' + '='.repeat(70));
if (allTestsPassed) {
  console.log(`${GREEN}✓ All static checks passed!${RESET}`);
  console.log('\nBug fixes verified in source code:');
  console.log('  1. ✅ isReadOnly: false (sequential execution)');
  console.log('  2. ✅ ToolContext includes toolUseId');
  console.log('  3. ✅ ask-user.ts extracts and uses toolUseId');
  console.log('  4. ✅ Engine passes toolUseId in context');
} else {
  console.log(`${RED}✗ Some checks failed${RESET}`);
  console.log('Please review the failed checks above.');
  process.exit(1);
}
console.log('='.repeat(70));
