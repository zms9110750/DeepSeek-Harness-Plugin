/**
 * @local/secrets-llm — the value behind a credential reference, read from a
 * .NET user-secrets document at launch.
 *
 * A profile names references; it never contains a key, an endpoint, or a model
 * id. At apply this plugin reads the secrets file once, answers those
 * references from memory, and mounts `llm-pi-ai` with the route the same file
 * describes. Nothing secret is written to disk or to a log: the store answers
 * `resolve` with the value and everything else with facts about it.
 *
 * Why the credentials seam and not an environment variable: an environment
 * variable is a copy of the secret in a second place, and it is readable by
 * every child process. Here the file stays the single source and the value
 * lives only in this process's memory.
 *
 * Why this plugin mounts pi-ai itself: pi-ai's `apiKeyEnv` is the only field a
 * credential reference may appear in (`baseURL` and `models` are plain
 * strings), so a profile that wanted all three values behind references could
 * not name them at all. Mounting pi-ai with a config built here is what makes
 * the file the only place all three are written.
 *
 * @module @local/secrets-llm
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = '@local/secrets-llm'

/** The mount needs the LLM registry pi-ai registers its route into. */
export const inject = ['llm']

/** Default reference prefix when `refPrefix` is not configured. */
const DEFAULT_ROOT = 'OpenAI'
/** Only offered protocols this plugin knows how to default to. */
const DEFAULT_API = 'openai-completions'
/** Fallbacks for a model the endpoint does not describe; a relay rarely publishes them. */
const DEFAULT_CONTEXT_WINDOW = 1_000_000
const DEFAULT_MAX_TOKENS = 65_536

/** Turn a section name into a POSIX-shell-shaped reference prefix. */
function refPrefixOf(section) {
  const cleaned = String(section)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return cleaned.length === 0 ? 'LLM' : /^[A-Za-z_]/.test(cleaned) ? cleaned : `LLM_${cleaned}`
}

/** Walk a dotted or `:`-separated path through the parsed document. */
function atPath(document, path) {
  return String(path)
    .split(/[:.]/g)
    .filter((segment) => segment.length > 0)
    .reduce((node, segment) => (node === undefined || node === null ? undefined : node[segment]), document)
}

/** Read one non-empty string field, naming where it came from without naming its value. */
function fieldOf(bucket, field, where) {
  const raw = bucket?.[field]
  if (raw === undefined || raw === null) throw new Error(`@local/secrets-llm: ${where} has no "${field}" entry`)
  const value = String(raw).trim()
  if (value.length === 0) throw new Error(`@local/secrets-llm: ${where} has a blank "${field}" entry`)
  return value
}

/**
 * The credential store this profile runs on: values come from the file,
 * nothing can be written back.
 * @param {Map<string, {value: string, field: string}>} values - reference to file field.
 */
function fileBackedStore(values) {
  const readOnly = (what) => {
    throw new Error(`@local/secrets-llm: this credential store is read-only; ${what} comes from the configured secrets file, so edit that file instead`)
  }
  return {
    async resolve(ref) {
      const hit = values.get(String(ref))
      return hit === undefined ? undefined : { value: hit.value, source: 'file' }
    },
    async describe(ref) {
      const hit = values.get(String(ref))
      return hit === undefined
        ? { configured: false, writable: false }
        : { configured: true, source: 'file', writable: false }
    },
    async set() { readOnly('a stored value') },
    async unset() { readOnly('removal') },
    /** This store holds no `<scope>/<id>` records; sign-in flows have no home here. */
    async readRecord() { return undefined },
    async describeRecord() { return { configured: false, writable: false } },
    async listRecords() { return [] },
    async modifyRecord() { readOnly('a credential record') },
    async deleteRecord() { /* nothing is stored, so nothing can be removed */ },
  }
}

/**
 * Load the host's own pi-ai package.
 *
 * A profile's `node_modules` holds only the profile's plugins: the harness
 * ships in the application, so a bare specifier cannot resolve from here. The
 * host's entry point is inside the application tree, and resolving from there
 * walks up to the `node_modules` that owns every `@deepseek-ai` package.
 * @returns the module namespace.
 */
async function loadPiAi() {
  const tried = []
  try {
    return await import('@deepseek-ai/dsh-llm-pi-ai')
  } catch (error) {
    tried.push(`bare import: ${error instanceof Error ? error.message : String(error)}`)
  }
  const anchors = [process.argv[1], process.execPath]
    .filter((value) => typeof value === 'string' && value.length > 0)
    // A packaged app runs from asar; its package tree sits under resources.
    .concat(typeof process.resourcesPath === 'string'
      ? [join(process.resourcesPath, 'app.asar', 'dsh', 'index.js')]
      : [])
  for (const anchor of anchors) {
    try {
      const resolved = createRequire(anchor).resolve('@deepseek-ai/dsh-llm-pi-ai')
      return await import(pathToFileURL(resolved).href)
    } catch (error) {
      tried.push(`${dirname(anchor)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(tried.join(' | '))
}

/**
 * The pi-ai provider config this plugin mounts, built from the values it read.
 * Pure, so the shape is testable without a live registry: the key appears only
 * as `apiKeyEnv`, the reference its route resolves per request.
 */
export function routeConfig({ provider, displayName, api, url, refApiKey, model, contextWindow, maxTokens }) {
  return {
    providers: {
      [provider]: {
        displayName,
        api,
        baseURL: url,
        apiKeyEnv: refApiKey,
        models: [{ id: model, name: model, contextWindow, maxTokens, input: ['text'] }],
      },
    },
  }
}

export async function apply(ctx, config) {
  const secretsFile = config?.secretsFile
  const section = config?.section
  if (typeof secretsFile !== 'string' || secretsFile.length === 0) {
    throw new Error('@local/secrets-llm: "secretsFile" must name the user-secrets JSON document to read')
  }
  if (typeof section !== 'string' || section.length === 0) {
    throw new Error('@local/secrets-llm: "section" must name the section holding url, apiKey, and model')
  }

  const path = resolvePath(secretsFile)
  const where = `section "${section}" of ${path}`
  let document
  try {
    // .NET writes this document with a UTF-8 BOM, which JSON.parse refuses.
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    document = JSON.parse(text)
  } catch (error) {
    throw new Error(`@local/secrets-llm: cannot read ${path} (${error instanceof Error ? error.message : String(error)})`, { cause: error })
  }

  // A .NET user-secrets document nests sections under a root key; a hand-written
  // file may put them at the top level, so both are accepted.
  const rootDocument = atPath(document, config?.root ?? DEFAULT_ROOT)
  const bucket = (rootDocument !== null && typeof rootDocument === 'object' ? rootDocument[section] : undefined)
    ?? atPath(document, section)
  if (bucket === undefined || bucket === null || typeof bucket !== 'object') {
    throw new Error(`@local/secrets-llm: ${where} is missing; found ${describeSections(document)}`)
  }

  const url = fieldOf(bucket, config?.fields?.url ?? 'url', where)
  const apiKey = fieldOf(bucket, config?.fields?.apiKey ?? 'apiKey', where)
  const model = config?.model ?? fieldOf(bucket, config?.fields?.model ?? 'model', where)

  const prefix = config?.refPrefix ?? refPrefixOf(section)
  const refs = {
    apiKey: `${prefix}_API_KEY`,
    url: `${prefix}_URL`,
    model: `${prefix}_MODEL`,
  }
  const values = new Map([
    [refs.apiKey, { value: apiKey, field: 'apiKey' }],
    [refs.url, { value: url, field: 'url' }],
    [refs.model, { value: String(model), field: 'model' }],
  ])

  if (ctx.get('credentials') !== undefined) {
    throw new Error(`@local/secrets-llm: this composition already mounts a credentials store; disable that row (headless does) so this one can answer ${refs.apiKey}`)
  }
  ctx.provide('credentials', fileBackedStore(values))

  // Facts, never the key: enough to prove the right section was read.
  ctx.logger.info(
    '@local/secrets-llm: %s -> url %s, model %s, key %d chars (%s)',
    where, url, String(model), apiKey.length, refs.apiKey,
  )

  if (config?.mountPiAi === false) return

  const provider = config?.provider ?? 'secrets-llm'
  const displayName = config?.displayName ?? section
  const api = config?.api ?? DEFAULT_API
  const contextWindow = config?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS

  let module
  try {
    module = await loadPiAi()
  } catch (error) {
    ctx.logger.error('@local/secrets-llm: cannot load @deepseek-ai/dsh-llm-pi-ai, so route "%s" is not mounted (%s)', provider, error instanceof Error ? error.message : String(error))
    return
  }
  // The mount carries every value this plugin just read; nothing is re-read here.
  ctx.plugin(module.default ?? module, routeConfig({
    provider,
    displayName,
    api,
    url,
    refApiKey: refs.apiKey,
    model: String(model),
    contextWindow,
    maxTokens,
  }))
}

/** Name the sections a wrong `section` value could have meant. */
function describeSections(document) {
  if (document === null || typeof document !== 'object') return 'no object at the document root'
  const root = document[DEFAULT_ROOT] ?? document
  if (root === null || typeof root !== 'object') return 'no sections under the root'
  return `sections ${Object.keys(root).map((key) => `"${key}"`).join(', ')}`
}
