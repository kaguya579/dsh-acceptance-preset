// 插件工具装配 kit：四个验收工具的共享样板（沙箱策略戳 / fs 适配器 / 路径校验 / 产物根解析）。
// 策略戳约定（README 安全姿态）在此单一实现，新工具直接复用。

import { FACTS_FILENAME, STATIC_FACTS_FILENAME, RECORD_FILENAME } from '../lib/names.mjs'

const ARTIFACT_FILES = {
  report: '验收报告.md',
  issues: '问题清单.md',
  facts: FACTS_FILENAME,
  static_facts: STATIC_FACTS_FILENAME,
  record: RECORD_FILENAME,
}

/** 规范化绝对路径（去引号、校验盘符/UNC）；无效返回 null。 */
export function normPath(value) {
  let text = String(value).trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  if (text.length === 0) return null
  if (!/^[a-zA-Z]:[\\/]/.test(text) && !text.startsWith('\\\\')) {
    throw new Error('请提供绝对路径：交付物目录与需求/合同目录由用户分别提供')
  }
  return text
}

export function validateProject(project) {
  const value = String(project).trim()
  if (value.length === 0) throw new Error('project 必填')
  if (/[\\/"']/.test(value)) throw new Error('project 不能包含路径分隔符或引号')
  return value
}

export function validateRound(round) {
  const value = Number(round)
  if (!Number.isInteger(value) || value < 1) throw new Error('round 必须是正整数')
  return value
}

export function artifactFile(artifact) {
  const name = ARTIFACT_FILES[artifact]
  if (name === undefined) throw new Error('artifact 必须是 report/issues/facts/static_facts/record 之一')
  return name
}

export function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * harness fs 服务 → lib 所需的适配器（全部绝对路径）。写入时盖会话沙箱策略戳。
 * readBytes 契约：超过 maxBytes 或底层 TOO_LARGE 时返回 null（不抛错）。
 */
export function harnessAdapter(fs, policyOf) {
  return {
    async stat(absPath) {
      const target = await fs.resolve(absPath)
      const info = await fs.stat(target)
      return info === undefined ? null : { type: info.type, size: info.size ?? 0 }
    },
    async readText(absPath) {
      return fs.readText(await fs.resolve(absPath))
    },
    async readBytes(absPath, maxBytes) {
      const target = await fs.resolve(absPath)
      try {
        return await fs.readBytes(target, undefined, maxBytes)
      } catch (error) {
        if (String(error?.code ?? '').includes('TOO_LARGE')) return null
        throw error
      }
    },
    async writeText(absPath, content) {
      try {
        await fs.writeText(await fs.resolve(absPath), content, undefined, undefined, policyOf())
      } catch (error) {
        if (error?.code === 'FS_SANDBOX_DENIED') {
          throw new Error(`[sandbox: 产物目录写入被会话沙箱拒绝] ${absPath} 不在当前会话可写范围内。`
            + `请把 out_dir 指向会话工作区内的目录（如 <交付物>\\acceptance），或切换会话权限（/permission danger-full-access）后重试。原始信息：${error.message}`)
        }
        throw error
      }
    },
    async listDir(absPath) {
      const entries = await fs.listDir(await fs.resolve(absPath))
      return entries.map((entry) => ({ name: entry.name, type: entry.type, size: entry.size ?? 0 }))
    },
  }
}

/** 解析当前工具调用所属会话的沙箱策略（会话不存在/服务缺失时回落部署默认）。 */
export function resolveSessionPolicy(ctx, exec) {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const agent = exec?.agent
  if (sandboxPolicy === undefined || agent === undefined) return null
  try {
    return sandboxPolicy.resolve({ session: agent.session })
  } catch {
    return null
  }
}

/** 解析产物根目录：工具参数 out_dir > config.outDir > 用途回落值。 */
export function resolveOutDir(args, fallback, config) {
  if (typeof args.out_dir === 'string' && args.out_dir.trim() !== '') {
    const explicit = normPath(args.out_dir)
    if (explicit === null) throw new Error('out_dir 路径无效')
    return explicit
  }
  if (typeof config.outDir === 'string' && config.outDir.trim() !== '') {
    return String(config.outDir)
  }
  return fallback
}

/** 工具调用装配：独立解析会话沙箱策略并构建盖戳适配器（每次调用新建，无共享态）。 */
export function withRoundAccess(ctx, exec) {
  const fs = ctx.get('fs')
  const policy = resolveSessionPolicy(ctx, exec)
  return { fs, adapter: harnessAdapter(fs, () => policy) }
}
