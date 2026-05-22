# ReadTool PDF 支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ReadTool 能提取 PDF 文本内容和表单字段, 作为纯文本返回给 LLM

**Architecture:** 在 ReadTool 的 `call()` 方法中增加 PDF 检测分支, 使用 `pdfjs-dist` 动态提取文本和表单字段, 然后复用现有的行号格式化逻辑输出

**Tech Stack:** TypeScript, Node.js ≥18, pdfjs-dist ^4.0.0

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `package.json` | 添加 `pdfjs-dist` 为 optional dependency | Modify |
| `src/tools/read.ts` | 移除 `pdf` from BINARY_EXTENSIONS, 新增 PDF 提取分支和 `extractPdfText()` 辅助函数 | Modify |
| `package-lock.json` | 安装 pdfjs-dist 后的锁文件更新 | Auto-generated |

---

### Task 1: 安装 pdfjs-dist 为 optional dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 修改 package.json 添加 optionalDependencies**

  在 `package.json` 的 `dependencies` 同级位置添加 `optionalDependencies`:

  ```json
  "optionalDependencies": {
    "pdfjs-dist": "^4.10.0"
  }
  ```

  这里用 `^4.10.0` 是因为 pdfjs-dist v4 是当前最新主版本, 且有更稳定的 `getFieldObjects()` API。

- [ ] **Step 2: 运行 npm install**

  ```bash
  npm install
  ```

  Expected: `pdfjs-dist` 被安装, `package-lock.json` 更新

- [ ] **Step 3: Commit**

  ```bash
  git add package.json package-lock.json
  git commit -m "deps: add pdfjs-dist as optional dependency for PDF text extraction"
  ```

---

### Task 2: 实现 PDF 提取辅助函数

**Files:**
- Modify: `src/tools/read.ts` (添加 `extractPdfText` 函数)

- [ ] **Step 1: 在 `sniffMime` 函数之后添加 `extractPdfText` 辅助函数**

  在 `src/tools/read.ts` 的第 85 行之前 (也就是 `defineTool` 调用之前) 插入以下函数:

  ```typescript
  interface ExtractPdfResult {
    text: string
    pageCount: number
    fieldCount: number
  }

  async function extractPdfText(filePath: string): Promise<ExtractPdfResult> {
    try {
      const pdfjs = await import('pdfjs-dist')
      // 禁用 worker, 单线程提取 (桌面环境足够)
      if ((pdfjs as any).GlobalWorkerOptions) {
        (pdfjs as any).GlobalWorkerOptions.workerSrc = ''
      }

      const data = await readFile(filePath)
      const doc = await pdfjs.getDocument({ data }).promise
      const pageCount = doc.numPages

      let fullText = `--- PDF: ${filePath} (${pageCount} page${pageCount !== 1 ? 's' : ''}) ---\n\n`

      // 提取每页文本
      for (let i = 1; i <= pageCount; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        const pageText = content.items
          .map((item: any) => item.str)
          .join('')
          .trim()

        fullText += `=== Page ${i} ===\n${pageText}\n\n`
        page.cleanup()
      }

      // 提取表单字段 (AcroForm)
      let fieldCount = 0
      try {
        const fieldObjects = await doc.getFieldObjects()
        if (fieldObjects && Object.keys(fieldObjects).length > 0) {
          const formFields: Record<string, string> = {}
          for (const [name, field] of Object.entries(fieldObjects)) {
            if (Array.isArray(field)) {
              const values = field
                .map((f: any) => f.value)
                .filter((v: any) => v !== undefined && v !== null && v !== '')
              if (values.length > 0) {
                formFields[name] = values.join(', ')
              }
            } else {
              const value = (field as any)?.value
              if (value !== undefined && value !== null && value !== '') {
                formFields[name] = String(value)
              }
            }
          }

          if (Object.keys(formFields).length > 0) {
            fieldCount = Object.keys(formFields).length
            fullText += `=== Form Fields (${fieldCount}) ===\n`
            for (const [name, value] of Object.entries(formFields)) {
              fullText += `${name}: ${value}\n`
            }
            fullText += '\n'
          }
        }
      } catch {
        // 忽略表单提取错误 (不是所有 PDF 都有表单)
      }

      await doc.destroy()

      return { text: fullText.trimEnd(), pageCount, fieldCount }
    } catch (err: any) {
      if (err.message?.includes('password')) {
        throw new Error('Encrypted PDF not supported')
      }
      throw new Error(`Failed to parse PDF: ${err.message}`)
    }
  }
  ```

- [ ] **Step 2: 验证 TypeScript 编译无错误**

  ```bash
  npx tsc --noEmit
  ```

  Expected: 无编译错误 (可能会有类型警告, 因为 pdfjs-dist 类型可能不够完善, 但不应该有类型错误导致编译失败)

- [ ] **Step 3: Commit**

  ```bash
  git add src/tools/read.ts
  git commit -m "feat: add extractPdfText helper for PDF text and form extraction"
  ```

---

### Task 3: 修改 ReadTool 主逻辑支持 PDF

**Files:**
- Modify: `src/tools/read.ts`

- [ ] **Step 1: 从 BINARY_EXTENSIONS 中移除 `pdf`**

  修改第 17-22 行:

  ```typescript
  const BINARY_EXTENSIONS = new Set([
    'doc', 'docx',
    'xls', 'xlsx',
    'ppt', 'pptx',
    // 'pdf',  ← 移除这一行
    'odt', 'ods', 'odp',
    'rtf',
    'exe', 'dll', 'so', 'dylib', 'wasm',
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
    'jar', 'war', 'class',
    'woff', 'woff2', 'ttf', 'eot', 'otf',
    'mp3', 'mp4', 'avi', 'mov', 'mkv', 'flac', 'wav', 'wmv',
    'sqlite', 'db',
    'bin', 'dat', 'obj', 'o', 'a', 'lib',
    'pyc', 'pyo',
  ])
  ```

- [ ] **Step 2: 在 image attachment 检查之后添加 PDF 分支**

  在 `isImageAttachment(mime)` 检查之后 (第 142 行 `return { ... }` 之后), 添加 PDF 处理逻辑:

  ```typescript
      if (isImageAttachment(mime)) {
        const buffer = await readFile(filePath)
        const base64 = buffer.toString('base64')
        return {
          data: [
            { type: 'text' as const, text: `[Image file: ${filePath} (${fileStat.size} bytes, ${mime})]` },
            { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as any, data: base64 } },
          ],
        }
      }

      // PDF 处理
      if (mime === 'application/pdf') {
        try {
          const { text } = await extractPdfText(filePath)
          const lines = text.split('\n')
          const offset = input.offset || 0
          const limit = input.limit || 2000
          const selectedLines = lines.slice(offset, offset + limit)

          const numbered = selectedLines.map((line: string, i: number) => {
            const lineNum = offset + i + 1
            return `${lineNum}\t${line}`
          }).join('\n')

          let result = numbered
          if (lines.length > offset + limit) {
            result += `\n\n(${lines.length - offset - limit} more lines not shown)`
          }

          return result || '(empty PDF)'
        } catch (err: any) {
          if (err.message?.includes('Cannot find module') || err.message?.includes('pdfjs-dist')) {
            return {
              data: `Error: PDF support requires pdfjs-dist. Install it with: npm install pdfjs-dist`,
              is_error: true,
            }
          }
          return {
            data: `Error: ${err.message}`,
            is_error: true,
          }
        }
      }

      if (isBinaryByExtension(filePath) || isBinaryByContent(sample)) {
        return { data: `Cannot read binary file: ${filePath}`, is_error: true }
      }
  ```

- [ ] **Step 3: 更新 ReadTool 的 description**

  修改 `description` 属性, 在 `Supports text files, images` 之后添加 `, PDFs`:

  ```typescript
  description: 'Read a file from the filesystem. Returns content with line numbers. Supports text files, images (returns visual content), and PDFs.',
  ```

- [ ] **Step 4: 运行编译检查**

  ```bash
  npx tsc --noEmit
  ```

  Expected: 无编译错误

- [ ] **Step 5: Commit**

  ```bash
  git add src/tools/read.ts
  git commit -m "feat: enable PDF reading in ReadTool via pdfjs-dist"
  ```

---

### Task 4: 验证现有测试不中断

**Files:**
- 所有现有测试文件

- [ ] **Step 1: 运行现有的 example 测试**

  ```bash
  npm test
  ```

  Expected: `examples/01-simple-query.ts` 成功运行, 无错误

- [ ] **Step 2: 运行全部 examples**

  ```bash
  npm run test:all
  ```

  Expected: 所有 examples 成功运行 (注意: 如果某个 example 依赖 ReadTool 且读取了 PDF, 可能会触发新的行为)

- [ ] **Step 3: Commit (如果有任何修复)**

  ```bash
  # 如果有修复, 提交
  git add -A
  git commit -m "fix: ensure existing tests pass after PDF support"
  # 如果没有需要修复的, 此步骤跳过
  ```

---

### Task 5: 手动验证 PDF 读取功能

**Files:**
- 需要一个测试 PDF 文件

- [ ] **Step 1: 创建测试用例 (使用示例文件验证)**

  在 `examples/` 下创建一个临时测试脚本 `test-pdf.ts`:

  ```typescript
  import { readFileSync } from 'fs'
  import { createAgent } from '../src/index.js'

  async function test() {
    // 使用 SDK 中的某个文件来测试 ReadTool 是否正常工作
    const agent = createAgent()
    
    // 先测试非 PDF 文件确保没坏
    const r1 = await agent.prompt('Read README.md and tell me the first line')
    console.log('Text file test:', r1.text.substring(0, 100))
    
    // 测试 PDF 文件 (需要当前目录有 PDF)
    // 先尝试读取 PDF (如果存在)
    try {
      const r2 = await agent.prompt('Read package.json and tell me the version')
      console.log('Second test:', r2.text.substring(0, 100))
    } catch (err) {
      console.error('PDF test failed:', err)
    }
  }

  test()
  ```

  实际上更好的方式是直接测试 `extractPdfText` 函数, 但因为它不是导出的, 可以临时通过修改代码来测试:

  ```bash
  # 在 src/tools/read.ts 底部临时添加:
  # extractPdfText('/path/to/test.pdf').then(console.log).catch(console.error)
  ```

  或者更好的方法:

  ```bash
  # 创建一个测试脚本
  cat > /tmp/test-pdf.ts << 'EOF'
  import { readFileSync } from 'fs'
  
  // 模拟 pdfjs-dist 调用来验证
  async function test() {
    const pdfjs = await import('pdfjs-dist')
    console.log('pdfjs-dist loaded:', !!pdfjs.getDocument)
  }
  
  test().catch(console.error)
  EOF
  
  npx tsx /tmp/test-pdf.ts
  ```

  Expected: 输出 `pdfjs-dist loaded: true`

- [ ] **Step 2: 找一个 PDF 文件做实际测试**

  ```bash
  # 在当前仓库找一个 PDF (如果没有的话跳过)
  find . -name "*.pdf" -maxdepth 3 2>/dev/null || echo "No PDF found"
  
  # 或者创建一个简单的 PDF 用于测试 (如果有工具)
  # 如果没有 PDF 文件, 此步骤记录为: "需要用户在实际 PDF 上测试"
  ```

- [ ] **Step 3: 清理测试文件**

  ```bash
  rm -f /tmp/test-pdf.ts
  ```

  如果有临时修改, 确保不要提交它们。

---

### Task 6: 更新文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 Built-in tools 表格中的 Read 描述**

  在 README.md 的 Built-in tools 表格中 (约第 416 行), 更新 Read 行:

  ```markdown
  | **Read**                                   | Read files with line numbers (text, images, PDFs)          |
  ```

  或者保持原有格式, 确保 Read 工具的描述反映 PDF 支持:

  ```markdown
  | **Read**                                   | Read files with line numbers. Supports text, images, and PDFs. |
  ```

- [ ] **Step 2: 在 README 中添加关于 PDF 支持的说明段落**

  在 "Built-in tools" 章节之后或 "Quick start" 附近添加:

  ```markdown
  ### PDF Support

  The Read tool supports extracting text content from PDF files:
  
  ```typescript
  const agent = createAgent({ allowedTools: ['Read'] })
  const result = await agent.prompt('Read /path/to/document.pdf and summarize it')
  console.log(result.text)
  ```
  
  **Requirements:** Install `pdfjs-dist` for PDF support:
  
  ```bash
  npm install pdfjs-dist
  ```
  
  **Features:**
  - Extracts text from each page with page markers
  - Extracts AcroForm field values
  - Works with `offset` and `limit` parameters like text files
  ```

- [ ] **Step 3: 更新 ReadTool description (如果 package.json scripts 中有相关文档生成)**

  检查是否需要更新其他文档:

  ```bash
  grep -r "Read.*file.*image" docs/ 2>/dev/null || echo "No additional docs to update"
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add README.md
  git commit -m "docs: update README with PDF support for ReadTool"
  ```

---

## Self-Review Checklist

- [ ] Spec 覆盖: PDF 文本提取 ✅ (Task 2, 3)
- [ ] Spec 覆盖: 表单字段提取 ✅ (Task 2)
- [ ] Spec 覆盖: offset/limit 一致性 ✅ (Task 3, 复用现有逻辑)
- [ ] Spec 覆盖: optional dependency ✅ (Task 1)
- [ ] Spec 覆盖: 未安装时的错误提示 ✅ (Task 3)
- [ ] Spec 覆盖: 加密 PDF 处理 ✅ (Task 2)
- [ ] Placeholder scan: 无 TBD/TODO/placeholder ✅
- [ ] Type 一致性: `ExtractPdfResult` 接口在 Task 2 定义, Task 3 使用 ✅
- [ ] 文件路径: 所有路径使用绝对路径或从 repo root 的相对路径 ✅
