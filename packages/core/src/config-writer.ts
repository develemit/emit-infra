import { readFileSync, writeFileSync } from 'node:fs'
import { modify, applyEdits, parseTree, findNodeAtLocation, type JSONPath } from 'jsonc-parser'

const FORMATTING_OPTIONS = { insertSpaces: true, tabSize: 2, eol: '\n' } as const

/**
 * Create a brand-new .emit-infra.json. There is no prior formatting to
 * preserve, so a plain stringify is fine — use this only when the file does
 * not already exist.
 */
export function createConfigFile(configPath: string, config: unknown): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

/**
 * Set a single top-level field in an existing .emit-infra.json without
 * reformatting the rest of the file. A no-op write (value unchanged)
 * produces zero edits.
 */
export function setConfigField(configPath: string, path: JSONPath, value: unknown): void {
  const original = readFileSync(configPath, 'utf-8')
  const tree = parseTree(original)
  const isNewTopLevelKey = path.length === 1 && tree?.type === 'object' && !findNodeAtLocation(tree, path)

  const updated = isNewTopLevelKey
    ? insertTopLevelField(original, tree!, path[0] as string, value)
    : applyEdits(original, modify(original, path, value, { formattingOptions: FORMATTING_OPTIONS }))

  writeFileSync(configPath, updated)
}

/**
 * jsonc-parser's modify() reformats the previous sibling property when
 * inserting a brand-new key (it reprints "<prev prop>,\n<new prop>" as one
 * edit), which clobbers that sibling's original formatting even though it
 * wasn't touched. Insert manually instead: everything before the insertion
 * point is left byte-identical.
 */
function insertTopLevelField(original: string, tree: NonNullable<ReturnType<typeof parseTree>>, key: string, value: unknown): string {
  const properties = tree.children ?? []
  const valueJson = JSON.stringify(value, null, 2)

  if (properties.length === 0) {
    const openBrace = original.indexOf('{')
    return `${original.slice(0, openBrace + 1)}\n  "${key}": ${valueJson}\n${original.slice(openBrace + 1)}`
  }

  const last = properties[properties.length - 1]!
  const indent = indentOf(original, last.offset)
  const indentedValueJson = valueJson.split('\n').join(`\n${indent}`)
  const insertOffset = last.offset + last.length

  return `${original.slice(0, insertOffset)},\n${indent}"${key}": ${indentedValueJson}${original.slice(insertOffset)}`
}

function indentOf(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return text.slice(lineStart, offset).match(/^[ \t]*/)?.[0] ?? ''
}
