// 交付验收工具桥：把交付验收工具桥接为 DSH 模型工具（静态 preset 插件版）。
// 职责边界：只做确定性事实——调用验收工具 facts 出口 + 读取轮次产物；
// 四类偏差、问题分级、业务画像、接手方案等语义判断由 agent 完成。
// 配置来自 preset 组合行的 config 字段（见 agent.cordis.yml）：
//   projectRoot —— 交付验收项目根目录（必填）
//   pythonPath  —— python 解释器（缺省 <projectRoot>\.venv\Scripts\python.exe）
//   outDir      —— 验收产物根目录（缺省 <projectRoot>\acceptance）
//   sandboxMode —— 验收子进程沙箱模式（缺省 danger-full-access，原因见 README「安全姿态」）

const ROUND_DIR_RE = /^(.*?)-轮次(\d+)$/
const ARTIFACT_FILES = {
  report: '验收报告.md',
  issues: '问题清单.md',
  facts: '确定性事实.json',
  static_facts: '静态事实.json',
  record: '轮次记录.json',
}

function pwshQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function normPath(value, root) {
  let text = String(value).trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  if (text.length === 0) return null
  if (!/^[a-zA-Z]:[\\/]/.test(text) && !text.startsWith('\\\\')) {
    text = root + '\\' + text.replace(/[\\/]/g, '\\')
  }
  return text
}

function validateProject(project) {
  const value = String(project).trim()
  if (value.length === 0) throw new Error('project 必填')
  if (/[\\/"']/.test(value)) throw new Error('project 不能包含路径分隔符或引号')
  return value
}

function validateRound(round) {
  const value = Number(round)
  if (!Number.isInteger(value) || value < 1) throw new Error('round 必须是正整数')
  return value
}

function artifactFile(artifact) {
  const name = ARTIFACT_FILES[artifact]
  if (name === undefined) throw new Error('artifact 必须是 report/issues/facts/static_facts/record 之一')
  return name
}

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

export const name = 'acceptance-bridge'

export function apply(ctx, config = {}) {
  const shell = ctx.get('shell')
  const fs = ctx.get('fs')
  const tools = ctx.get('tools')
  if (shell === undefined || fs === undefined || tools === undefined) return
  const root = String(config.projectRoot || '')
  const python = String(config.pythonPath || (root === '' ? '' : root + '\\.venv\\Scripts\\python.exe'))
  const outRoot = String(config.outDir || (root === '' ? '' : root + '\\acceptance'))
  const sandboxMode = String(config.sandboxMode || 'danger-full-access')

  function requireConfig() {
    if (root === '' || python === '' || outRoot === '') {
      throw new Error('acceptance-bridge 未配置：请在 preset 组合行 tool-acceptance 的 config 中设置 projectRoot（必填）与可选的 pythonPath/outDir')
    }
  }

  function sandboxPolicy() {
    return { mode: sandboxMode, workspaceRoot: root }
  }

  const runTool = {
    name: 'acceptance_run',
    description: '对交付物执行一轮确定性验收分析（交付验收工具 facts 出口：安全解包、docx/pdf/md/xlsx 解析、tree-sitter 静态分析、补缺识别、轮次快照与变更识别；绝不调用 LLM、不产出报告与结论——四类偏差、问题分级、业务画像、接手方案等语义判断由 agent 基于返回的事实包完成）。大项目可能耗时数分钟。产物落盘 <outDir>/<项目>-轮次<N>/（确定性事实.json、静态事实.json、轮次记录.json），事实包同时内联在返回的 facts 字段。exitCode：0 成功、2 参数错误或运行错误。复验轮次（round_type=复验）自动识别变更并携带上轮问题清单（previous_issues），agent 应自行评估修复状态。',
    parameters: {
      deliverable: { type: 'string', required: true, description: '交付物目录或压缩包（zip/tar.gz）；绝对路径或相对 projectRoot' },
      baseline: { type: 'string', description: '可选：基线文件或目录（JSON/md/docx）；不提供则跳过补缺识别' },
      project: { type: 'string', required: true, description: '项目名称（字母、数字、中文、连字符；不含路径分隔符与引号）' },
      round: { type: 'number', required: true, description: '验收轮次（正整数）；同项目同轮次号会覆盖该轮产物' },
      round_type: { type: 'string', enum: ['例行验收', '复验'], description: '轮次类型；复验会基于上一轮轮次记录做变更识别' },
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    timeoutMs: 900000,
    async execute(args, exec) {
      requireConfig()
      const deliverable = normPath(args.deliverable, root)
      if (deliverable === null) throw new Error('deliverable 必填')
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const roundType = args.round_type === '复验' ? '复验' : '例行验收'
      const roundDir = outRoot + '\\' + project + '-轮次' + round
      const argv = [
        python, '-m', 'acceptance', 'facts',
        '--deliverable', deliverable,
        '--project', project,
        '--round', String(round),
        '--round-type', roundType,
        '--out', roundDir,
      ]
      if (typeof args.baseline === 'string' && args.baseline.trim() !== '') {
        const baseline = normPath(args.baseline, root)
        if (baseline === null) throw new Error('baseline 路径无效')
        argv.push('--baseline', baseline)
      }
      const request = {
        command: '& ' + argv.map(pwshQuote).join(' '),
        workdir: root,
        timeoutMs: 840000,
        stdoutMaxBytes: 262144,
        env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        sandboxPolicy: sandboxPolicy(),
      }
      const result = await shell.run(shell.resolve(request))
      const stdoutText = result.stdout.text
      const stderrText = result.stderr.text
      const response = {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        aborted: result.aborted,
        stdout: stdoutText.slice(-4000),
        stderr: stderrText.slice(-4000),
        stdoutTruncated: result.stdout.truncated,
        stderrTruncated: result.stderr.truncated,
        output_dir: roundDir,
      }
      if (result.exitCode !== 0) return response
      let facts = null
      let factsError = null
      try {
        const target = await fs.resolve(roundDir + '\\确定性事实.json')
        facts = JSON.parse(await fs.readText(target))
      } catch (error) {
        factsError = String(error)
      }
      return { ...response, facts, facts_error: factsError }
    },
  }
  ctx.effect(() => tools.register(runTool), 'tool: acceptance_run')

  const listTool = {
    name: 'acceptance_list_rounds',
    description: '列出验收产物根目录下已完成的验收轮次（项目、轮次号与各轮产物文件清单），供复验与跨轮对比使用。',
    parameters: {
      project: { type: 'string', description: '可选：只列指定项目的轮次' },
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args, exec) {
      requireConfig()
      const rootTarget = await fs.resolve(outRoot)
      if ((await fs.stat(rootTarget)) === undefined) {
        return { rounds: [], note: '验收产物根目录尚不存在（还没有任何验收轮次）' }
      }
      const filter = typeof args.project === 'string' ? args.project.trim() : ''
      const rounds = []
      for (const entry of await fs.listDir(rootTarget)) {
        if (entry.type !== 'directory') continue
        const match = ROUND_DIR_RE.exec(entry.name)
        if (match === null) continue
        const project = match[1]
        const round = Number(match[2])
        if (filter !== '' && project !== filter) continue
        const files = []
        for (const child of await fs.listDir(entry.target)) {
          files.push({ name: child.name, type: child.type, size: child.size === undefined ? null : child.size })
        }
        rounds.push({ project, round, dir: entry.name, files })
      }
      return { rounds }
    },
  }
  ctx.effect(() => tools.register(listTool), 'tool: acceptance_list_rounds')

  const readTool = {
    name: 'acceptance_read',
    description: '读取某项目某轮次的验收产物：report=验收报告.md、issues=问题清单.md（旧版 pipeline 产物）；facts=确定性事实.json（facts 出口的结构化事实包）、static_facts=静态事实.json、record=轮次记录.json（文件 sha256 快照与上轮问题，复验修复状态的基础）。JSON 产物返回解析后的对象，report/issues 返回 markdown 全文。',
    parameters: {
      project: { type: 'string', required: true, description: '项目名称' },
      round: { type: 'number', required: true, description: '轮次（正整数）' },
      artifact: { type: 'string', required: true, enum: ['report', 'issues', 'facts', 'static_facts', 'record'], description: '产物类型' },
    },
    output: { schema: { type: 'object' }, render: jsonRender },
    async execute(args, exec) {
      requireConfig()
      const project = validateProject(args.project)
      const round = validateRound(args.round)
      const filename = artifactFile(args.artifact)
      const path = outRoot + '\\' + project + '-轮次' + round + '\\' + filename
      const target = await fs.resolve(path)
      const text = await fs.readText(target)
      if (args.artifact === 'report' || args.artifact === 'issues') {
        return { path, text }
      }
      let json = null
      let parseError = null
      try {
        json = JSON.parse(text)
      } catch (error) {
        parseError = String(error)
      }
      return { path, json, parse_error: parseError }
    },
  }
  ctx.effect(() => tools.register(readTool), 'tool: acceptance_read')

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'tool:acceptance',
      order: 121,
      text: '交付验收工具桥：acceptance_run 只执行确定性层（解析/静态分析/补缺/轮次快照，事实包内联返回），绝不调用工具自带 LLM；四类偏差、问题分级、业务画像、接手方案等语义判断由你基于事实包完成（可配合 read/grep 下钻交付物代码与文档取证）。术语与判定口径见交付验收项目 CONTEXT.md：验收结论为通过/打回/无法判定（无基线为建议通过/建议整改/无法判定）。复验轮次：对比事实包 changes 与 previous_issues 识别变更与修复状态。领域专项：车辆诊断（UDS）业务描述见 src/acceptance/profiles/diagnostic/业务描述.md，相关交付物验收时应先读它并按其检查重点执行。',
    }), 'prompt: acceptance guide')
  }
}
