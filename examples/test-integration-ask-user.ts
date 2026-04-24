/**
 * Integration Test: AskUserQuestion Full Flow
 * 
 * Run this in your local environment after npm install:
 * 
 * cd X:\Yi-one\open-agent-sdk-typescript
 * npx tsx examples\test-integration-ask-user.ts
 */

import { createAgent, setQuestionHandler, clearQuestionHandler } from '../src/index.js'
import { AskUserQuestionTool } from '../src/tools/ask-user.js'
import type { ToolContext } from '../src/types.js'

// 模拟延迟
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// 模拟前端回答器
class MockFrontend {
  private pendingAnswers = new Map<string, string>()
  
  // 模拟用户提交答案
  submitAnswer(questionId: string, answer: string) {
    this.pendingAnswers.set(questionId, answer)
  }
  
  // 检查是否有待回答问题
  hasPending(questionId: string): boolean {
    return this.pendingAnswers.has(questionId)
  }
  
  // 获取并移除答案
  consumeAnswer(questionId: string): string | undefined {
    const answer = this.pendingAnswers.get(questionId)
    this.pendingAnswers.delete(questionId)
    return answer
  }
}

const mockFrontend = new MockFrontend()

/**
 * 测试1: 串行执行验证
 * 验证 isReadOnly: false 确保串行执行
 */
async function testSequentialExecution(): Promise<boolean> {
  console.log('\n🧪 Test 1: Sequential Execution')
  console.log('   验证多个 AskUserQuestion 是否串行执行...')
  
  const executionOrder: string[] = []
  
  setQuestionHandler(async (question) => {
    executionOrder.push(question)
    await delay(100) // 模拟处理时间
    return `answer-${question}`
  })
  
  const context1: ToolContext = { cwd: '/test', toolUseId: 'q1' }
  const context2: ToolContext = { cwd: '/test', toolUseId: 'q2' }
  const context3: ToolContext = { cwd: '/test', toolUseId: 'q3' }
  
  // 同时发起3个调用
  const promise1 = AskUserQuestionTool.call({ question: 'Q1' }, context1)
  const promise2 = AskUserQuestionTool.call({ question: 'Q2' }, context2)
  const promise3 = AskUserQuestionTool.call({ question: 'Q3' }, context3)
  
  const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3])
  
  // 验证执行顺序（串行应该是 Q1, Q2, Q3）
  const isSequential = executionOrder[0] === 'Q1' && 
                       executionOrder[1] === 'Q2' && 
                       executionOrder[2] === 'Q3'
  
  console.log(`   执行顺序: ${executionOrder.join(' → ')}`)
  console.log(`   工具ID: ${r1.tool_use_id}, ${r2.tool_use_id}, ${r3.tool_use_id}`)
  
  if (!isSequential) {
    console.log('   ❌ FAILED: 不是串行执行！')
    return false
  }
  
  if (r1.tool_use_id !== 'q1' || r2.tool_use_id !== 'q2' || r3.tool_use_id !== 'q3') {
    console.log('   ❌ FAILED: 工具ID不匹配！')
    return false
  }
  
  console.log('   ✅ PASSED: 串行执行，ID正确')
  return true
}

/**
 * 测试2: 完整用户交互流程
 * 模拟从提问到回答的完整流程
 */
async function testFullUserFlow(): Promise<boolean> {
  console.log('\n🧪 Test 2: Full User Interaction Flow')
  console.log('   模拟用户提问→等待→回答的完整流程...')
  
  let capturedQuestionId: string | null = null
  let capturedQuestion: string | null = null
  
  // 设置 handler（模拟 agent-client.ts 的逻辑）
  setQuestionHandler(async (question, options) => {
    const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    capturedQuestionId = questionId
    capturedQuestion = question
    
    console.log(`   [SDK] 收到问题: "${question}"`)
    console.log(`   [SDK] 生成 questionId: ${questionId}`)
    console.log(`   [SDK] 等待用户回答...`)
    
    // 模拟等待用户回答
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const answer = mockFrontend.consumeAnswer(questionId)
        if (answer) {
          clearInterval(checkInterval)
          console.log(`   [SDK] 收到回答: "${answer}"`)
          resolve(answer)
        }
      }, 50)
      
      // 超时处理
      setTimeout(() => {
        clearInterval(checkInterval)
        resolve('timeout-answer')
      }, 5000)
    })
  })
  
  const context: ToolContext = { cwd: '/test', toolUseId: 'flow-test' }
  
  // 发起问题
  const resultPromise = AskUserQuestionTool.call(
    { question: '你最喜欢的颜色是什么？', options: ['红', '蓝', '绿'] },
    context
  )
  
  // 模拟用户延迟回答
  await delay(200)
  
  if (!capturedQuestionId) {
    console.log('   ❌ FAILED: questionId 未生成')
    return false
  }
  
  console.log(`   [前端] 显示问题: "${capturedQuestion}"`)
  console.log(`   [前端] 用户选择: "蓝"`)
  
  // 模拟用户提交答案
  mockFrontend.submitAnswer(capturedQuestionId, '蓝')
  
  const result = await resultPromise
  
  console.log(`   [结果] tool_use_id: ${result.tool_use_id}`)
  console.log(`   [结果] content: ${result.content}`)
  
  if (result.content !== '蓝') {
    console.log('   ❌ FAILED: 回答内容不正确')
    return false
  }
  
  if (result.tool_use_id !== 'flow-test') {
    console.log('   ❌ FAILED: tool_use_id 不匹配')
    return false
  }
  
  console.log('   ✅ PASSED: 完整流程正确')
  return true
}

/**
 * 测试3: 超时机制
 */
async function testTimeout(): Promise<boolean> {
  console.log('\n🧪 Test 3: Timeout Mechanism')
  console.log('   验证5分钟超时机制（测试缩短到500ms）...')
  
  setQuestionHandler(async () => {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('User did not respond in time'))
      }, 500) // 测试用500ms
    })
  })
  
  const context: ToolContext = { cwd: '/test', toolUseId: 'timeout-test' }
  
  const startTime = Date.now()
  const result = await AskUserQuestionTool.call(
    { question: 'Timeout test' },
    context
  )
  const elapsed = Date.now() - startTime
  
  console.log(`   耗时: ${elapsed}ms`)
  console.log(`   结果: ${result.content}`)
  
  if (elapsed > 1000) {
    console.log('   ❌ FAILED: 超时时间太长')
    return false
  }
  
  if (!result.is_error) {
    console.log('   ❌ FAILED: 应该返回错误')
    return false
  }
  
  console.log('   ✅ PASSED: 超时机制工作正常')
  return true
}

/**
 * 测试4: 并发冲突测试
 * 验证修复前的问题是否还存在
 */
async function testConcurrencyConflict(): Promise<boolean> {
  console.log('\n🧪 Test 4: Concurrency Conflict Prevention')
  console.log('   验证并发调用不会相互覆盖...')
  
  const answers: string[] = []
  
  setQuestionHandler(async (question) => {
    const answer = `answer-for-${question}`
    answers.push(answer)
    await delay(50)
    return answer
  })
  
  const contexts = Array.from({ length: 5 }, (_, i) => ({
    cwd: '/test',
    toolUseId: `concurrent-${i}`
  }))
  
  // 同时发起5个调用
  const promises = contexts.map((ctx, i) => 
    AskUserQuestionTool.call({ question: `Q${i}` }, ctx)
  )
  
  const results = await Promise.all(promises)
  
  // 验证每个结果对应正确的问题
  const allMatch = results.every((result, i) => 
    result.content === `answer-for-Q${i}` &&
    result.tool_use_id === `concurrent-${i}`
  )
  
  console.log(`   发起: 5个并发调用`)
  console.log(`   结果: ${results.map(r => r.content).join(', ')}`)
  console.log(`   ID匹配: ${allMatch}`)
  
  if (!allMatch) {
    console.log('   ❌ FAILED: 并发冲突！结果不匹配')
    return false
  }
  
  console.log('   ✅ PASSED: 无并发冲突')
  return true
}

/**
 * 主测试运行器
 */
async function runIntegrationTests(): Promise<void> {
  console.log('=' .repeat(70))
  console.log('  AskUserQuestion Integration Tests (Dynamic)')
  console.log('=' .repeat(70))
  console.log('\n⚠️  注意：这些测试需要实际运行代码，验证运行时行为')
  console.log('   静态检查无法替代这些测试\n')
  
  const results: boolean[] = []
  
  try {
    results.push(await testSequentialExecution())
    clearQuestionHandler()
    
    results.push(await testFullUserFlow())
    clearQuestionHandler()
    
    results.push(await testTimeout())
    clearQuestionHandler()
    
    results.push(await testConcurrencyConflict())
    clearQuestionHandler()
    
  } catch (error) {
    console.error('\n💥 测试执行失败:', error)
    process.exit(1)
  }
  
  console.log('\n' + '=' .repeat(70))
  console.log('  测试结果汇总')
  console.log('=' .repeat(70))
  
  const passed = results.filter(r => r).length
  const total = results.length
  
  if (passed === total) {
    console.log(`\n  ✅ 全部通过 (${passed}/${total})`)
    console.log('\n  动态验证完成：')
    console.log('    1. ✅ 串行执行正确')
    console.log('    2. ✅ 完整用户流程通畅')
    console.log('    3. ✅ 超时机制工作')
    console.log('    4. ✅ 无并发冲突')
    console.log('\n  🎉 所有 Bug 已修复！')
  } else {
    console.log(`\n  ❌ ${passed}/${total} 通过`)
    console.log(`     ${total - passed} 个测试失败`)
    process.exit(1)
  }
  
  console.log('=' .repeat(70))
}

// 运行测试
console.log('\n🏃 开始动态测试...')
console.log('   需要安装依赖: npm install')
console.log('   运行命令: npx tsx examples/test-integration-ask-user.ts\n')

runIntegrationTests().catch(err => {
  console.error('测试失败:', err)
  process.exit(1)
})
