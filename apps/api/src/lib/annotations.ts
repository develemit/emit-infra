import { readFile, writeFile } from 'node:fs/promises'

export interface Annotation {
  note?: string | undefined
  falsePositive?: boolean | undefined
}

type AnnotationMap = Record<string, Annotation>

export async function readAnnotations(filePath: string): Promise<AnnotationMap> {
  try {
    const content = await readFile(filePath, 'utf8')
    return JSON.parse(content) as AnnotationMap
  } catch {
    return {}
  }
}

export async function writeAnnotation(filePath: string, key: string, patch: Annotation): Promise<void> {
  const map = await readAnnotations(filePath)
  map[key] = { ...map[key], ...patch }
  await writeFile(filePath, JSON.stringify(map, null, 2), 'utf8')
}
