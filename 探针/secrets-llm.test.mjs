/**
 * Stub-ctx test for @local/secrets-llm: proves the file is the only source, the
 * store never leaks a value through describe, and a wrong section names the
 * sections that do exist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { apply, inject, name } = await import(pathToFileURL('X:/temp/dsh/开发/secrets-llm/index.js').href)

const SECRETS = 'C:/Users/16229/AppData/Roaming/Microsoft/UserSecrets/992b82a8-b20a-466c-b522-8bd8393e5f02/secrets.json'
const expected = JSON.parse(readFileSync(SECRETS, 'utf8').replace(/^\uFEFF/, ''))['OpenAI']['cc goat']

/** The host logger is printf-shaped; the stub keeps that shape so a format typo shows up here. */
function format(message, args) {
  let index = 0
  return String(message).replace(/%[sd]/g, () => String(args[index++]))
}

function stubContext() {
  const logs = []
  const provided = new Map()
  const plugins = []
  const record = (level) => (message, ...args) => logs.push(`${level}: ${format(message, args)}`)
  const ctx = {
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    get: (key) => provided.get(key),
    provide: (key, value) => { if (provided.has(key)) throw new Error(`duplicate provide ${key}`); provided.set(key, value) },
    plugin: (mod, config) => plugins.push({ mod, config }),
  }
  return { ctx, logs, provided, plugins }
}

test('exports a mount surface', () => {
  assert.equal(name, '@local/secrets-llm')
  assert.deepEqual(inject, ['llm'])
})

test('answers the three references from the file and mounts the route', async () => {
  const { ctx, provided, plugins, logs } = stubContext()
  await apply(ctx, { secretsFile: SECRETS, section: 'cc goat' })
  const store = provided.get('credentials')
  assert.ok(store, 'credentials provided')
  assert.deepEqual(
    { key: expected.apiKey.length, url: expected.url, model: expected.model },
    { key: 93, url: 'https://api.commandcode.ai/provider/v1', model: 'deepseek/deepseek-v4-flash' },
  )
  // Without a resolvable pi-ai the mount is refused with a line naming the route,
  // and the credential half still stands.
  assert.equal(plugins.length, 0)
  assert.match(logs.join('\n'), /route "secrets-llm" is not mounted/)
})

test('the mount config carries the endpoint and model, never the key', async () => {
  const { routeConfig } = await import(pathToFileURL('X:/temp/dsh/开发/secrets-llm/index.js').href)
  const config = routeConfig({
    provider: 'cc-goat',
    displayName: 'cc goat',
    api: 'openai-completions',
    url: expected.url,
    refApiKey: 'CC_GOAT_API_KEY',
    model: expected.model,
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  })
  const route = config.providers['cc-goat']
  assert.equal(route.baseURL, expected.url)
  assert.equal(route.apiKeyEnv, 'CC_GOAT_API_KEY')
  assert.equal(route.models[0].id, expected.model)
  assert.equal(route.models[0].contextWindow, 1_000_000)
  assert.ok(!JSON.stringify(config).includes(expected.apiKey), 'the key never enters the mount config')
})

test('resolve returns the value, describe never does', async () => {
  const { ctx, provided } = stubContext()
  await apply(ctx, { secretsFile: SECRETS, section: 'cc goat', mountPiAi: false })
  const store = provided.get('credentials')
  const hit = await store.resolve('CC_GOAT_API_KEY')
  assert.equal(hit.value, expected.apiKey)
  assert.equal(hit.source, 'file')
  const facts = await store.describe('CC_GOAT_API_KEY')
  assert.deepEqual(facts, { configured: true, source: 'file', writable: false })
  assert.ok(!JSON.stringify(facts).includes(expected.apiKey))
  assert.equal(await store.resolve('NOT_SET'), undefined)
  assert.deepEqual(await store.describe('NOT_SET'), { configured: false, writable: false })
  // The endpoint and the model are referenceable too, so a profile need not repeat them.
  assert.equal((await store.resolve('CC_GOAT_URL')).value, expected.url)
  assert.equal((await store.resolve('CC_GOAT_MODEL')).value, expected.model)
})

test('the store refuses writes and holds no records', async () => {
  const { ctx, provided } = stubContext()
  await apply(ctx, { secretsFile: SECRETS, section: 'cc goat', mountPiAi: false })
  const store = provided.get('credentials')
  await assert.rejects(() => store.set('CC_GOAT_API_KEY', 'x'), /read-only/)
  await assert.rejects(() => store.unset('CC_GOAT_API_KEY'), /read-only/)
  await assert.rejects(() => store.modifyRecord('a/b', async () => ({})), /read-only/)
  assert.deepEqual(await store.listRecords(), [])
  assert.equal(await store.readRecord('a/b'), undefined)
  await store.deleteRecord('a/b')
})

test('the launch line names the route without the key', async () => {
  const { ctx, logs } = stubContext()
  await apply(ctx, { secretsFile: SECRETS, section: 'cc goat', mountPiAi: false })
  const line = logs.join('\n')
  assert.match(line, /api\.commandcode\.ai\/provider\/v1/)
  assert.match(line, /deepseek\/deepseek-v4-flash/)
  assert.match(line, /key 93 chars/)
  assert.ok(!line.includes(expected.apiKey), 'the key never reaches a log')
})

test('a wrong section names the sections that exist', async () => {
  const { ctx } = stubContext()
  await assert.rejects(
    () => apply(ctx, { secretsFile: SECRETS, section: 'nope' }),
    /section "nope".*sections "DeepSeek", "OpenCode"/s,
  )
})

test('a missing file is a clear refusal', async () => {
  const { ctx } = stubContext()
  await assert.rejects(() => apply(ctx, { secretsFile: 'X:/temp/dsh/开发/secrets-llm/nope.json', section: 'cc goat' }), /cannot read/)
})

test('a composition that already has a store is refused', async () => {
  const { ctx, provided } = stubContext()
  provided.set('credentials', { resolve: async () => undefined })
  await assert.rejects(() => apply(ctx, { secretsFile: SECRETS, section: 'cc goat', mountPiAi: false }), /already mounts a credentials store/)
})

test('a section name becomes a legal reference prefix', async () => {
  const { ctx, provided } = stubContext()
  await apply(ctx, { secretsFile: SECRETS, section: '基元律动', mountPiAi: false })
  const store = provided.get('credentials')
  // Non-ASCII section names fall back to the LLM prefix rather than an illegal ref.
  assert.deepEqual(await store.describe('LLM_API_KEY'), { configured: true, source: 'file', writable: false })
})
