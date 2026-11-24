import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { apply } from '../index.js'

const home = mkdtempSync(join(tmpdir(), 'skill-menu-studio-test-'))
process.env.DSH_HOME = home

after(() => {
  rmSync(home, { recursive: true, force: true })
})

/** One comparable summary for the fake registry. */
function summary(name, extra = {}) {
  return {
    name,
    description: `About ${name}`,
    path: `/skills/${name}/SKILL.md`,
    source: 'user-dsh',
    provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true },
    ...extra,
  }
}

/** Build a fake Cordis host context around the services this plugin reads. */
function fakeHost() {
  const effects = []
  const emitted = []
  const catalogs = new Map([
    ['standard', [summary('alpha'), summary('beta')]],
    ['solo', [summary('beta'), summary('gamma', { invocation: { modelInvocable: true, userInvocable: false } })]],
  ])
  let provider
  const services = {}

  const registry = {
    list({ scope }) {
      const key = scope ?? 'standard'
      return Promise.resolve(catalogs.get(key) ?? [])
    },
    get(name) {
      const found = [...catalogs.values()].flat().find((skill) => skill.name === name)
      if (found === undefined) return Promise.resolve(undefined)
      return Promise.resolve({ ...found, content: `BODY ${name}` })
    },
    registerProvider(create) {
      const control = { signal: new AbortController().signal, invalidate() {} }
      provider = create(control)
      return () => { provider = undefined }
    },
  }

  const presets = {
    list() {
      return Promise.resolve([
        { id: 'standard', name: 'Standard' },
        { id: 'solo', name: 'Solo' },
      ])
    },
    async acquireScope(id) {
      return { key: id, [Symbol.asyncDispose]: async () => {} }
    },
  }

  class FakeSkillCatalog {
    list() {
      return Promise.resolve({
        skills: [
          { name: 'alpha', description: 'About alpha', path: '/skills/alpha/SKILL.md', modelInvocable: true },
          { name: 'beta', description: 'About beta', path: '/skills/beta/SKILL.md', modelInvocable: true },
        ],
      })
    }
  }
  const catalogService = new FakeSkillCatalog()

  services.skills = registry
  services.agentPresets = presets
  services.sessionSkillCatalog = catalogService
  services.workingDirectory = { defaultDirectory: join(home, 'project') }
  services.workspaces = { list: () => [{ id: 'w1', path: join(home, 'project') }] }
  services.webServer = {
    register(route) {
      services.route = route
      return () => { delete services.route }
    },
  }

  const ctx = {
    webServer: services.webServer,
    get: (name) => services[name],
    inject(deps, callback) {
      // The fake host mounts every service up front, so the child plugin that
      // waits for optional services runs immediately against the same object.
      callback(ctx, undefined)
      return {}
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose)
      else effects.push(() => {})
    },
    emit(event, payload) {
      emitted.push([event, payload])
    },
    logger: { warn() {} },
  }
  return { ctx, services, effects, emitted, getProvider: () => provider, catalogService }
}

/** Start from a clean state file, then mount the plugin on a fresh fake host. */
function bootHost() {
  rmSync(join(home, 'skill-menu-studio.json'), { force: true })
  const host = fakeHost()
  apply(host.ctx)
  return host
}

/** Minimal HTTP request/response pair for the route handler. */
async function call(services, method, url, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const request = {
    method,
    url,
    headers: { host: '127.0.0.1:58217', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
  const response = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(text) {
      this.body = text
    },
  }
  await services.route.handler(request, response)
  return { status: response.status, json: JSON.parse(response.body) }
}

test('the panel API merges every preset and reports the overlay as active', async () => {
  const host = bootHost()
  const { status, json } = await call(host.services, 'GET', '/skill-menu-studio/skills?refresh=1')
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.patched, true)
  assert.deepEqual(json.skills.map((row) => row.name).sort(), ['alpha', 'beta', 'gamma'])
  const beta = json.skills.find((row) => row.name === 'beta')
  assert.deepEqual(beta.presets, ['standard', 'solo'])
  const gamma = json.skills.find((row) => row.name === 'gamma')
  assert.equal(gamma.userInvocable, false)
  assert.equal(json.counts.total, 3)
})

test('the slash catalog is decorated, and the alias loads the original body', async () => {
  const host = bootHost()

  const saved = await call(host.services, 'POST', '/skill-menu-studio/save', {
    name: 'alpha',
    hidden: false,
    alias: 'docs',
    description: 'The documentation skill',
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)
  assert.equal(saved.json.skills.find((row) => row.name === 'alpha').displayName, 'docs')
  assert.ok(host.emitted.some(([event]) => event === 'plugin-manager/changed'))
  const file = JSON.parse(readFileSync(join(home, 'skill-menu-studio.json'), 'utf8'))
  assert.deepEqual(file.skills.alpha, { alias: 'docs', description: 'The documentation skill' })

  const listed = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(listed.skills.map((skill) => skill.name), ['docs', 'beta'])
  const alias = listed.skills[0]
  assert.equal(alias.description, 'The documentation skill')
  assert.equal(alias.path, '/skills/alpha/SKILL.md')
  assert.equal(alias.modelInvocable, false)

  const definition = await host.getProvider().get({ name: 'docs', locator: { real: 'alpha' } }, {})
  assert.equal(definition.name, 'docs')
  assert.equal(definition.content, 'BODY alpha')
})

test('hiding removes the entry while the skill keeps loading by its real name', async () => {
  const host = bootHost()
  const hidden = await call(host.services, 'POST', '/skill-menu-studio/save', {
    name: 'beta',
    hidden: true,
    alias: '',
    description: '',
  })
  assert.equal(hidden.json.ok, true)
  const listed = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(listed.skills.map((skill) => skill.name), ['alpha'])
  const definition = await host.services.skills.get('beta')
  assert.equal(definition.content, 'BODY beta')
})

test('order, invalid names, and reset round-trip through the API', async () => {
  const host = bootHost()

  const reordered = await call(host.services, 'POST', '/skill-menu-studio/order', { order: ['gamma', 'beta', 'alpha'] })
  assert.equal(reordered.json.ok, true)
  assert.deepEqual(reordered.json.skills.map((row) => row.name), ['gamma', 'beta', 'alpha'])

  const rejected = await call(host.services, 'POST', '/skill-menu-studio/save', { name: 'beta', alias: 'Alpha', hidden: false, description: '' })
  assert.equal(rejected.json.ok, false)
  assert.equal(rejected.json.error, 'alias-invalid')

  const taken = await call(host.services, 'POST', '/skill-menu-studio/save', { name: 'beta', alias: 'alpha', hidden: false, description: '' })
  assert.equal(taken.json.error, 'alias-taken')

  const catalogMissing = await call(host.services, 'POST', '/skill-menu-studio/save', { name: 'missing', hidden: true, alias: '', description: '' })
  assert.equal(catalogMissing.json.error, 'unknown-skill')

  const reset = await call(host.services, 'POST', '/skill-menu-studio/reset', {})
  assert.equal(reset.json.ok, true)
  assert.equal(reset.json.counts.overrides, 0)
  const listed = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(listed.skills.map((skill) => skill.name), ['alpha', 'beta'])
})

test('a non-loopback peer is refused', async () => {
  const host = bootHost()
  const request = {
    method: 'GET',
    url: '/skill-menu-studio/skills',
    socket: { remoteAddress: '10.0.0.7' },
    async *[Symbol.asyncIterator]() {},
  }
  const response = { writeHead(status) { this.status = status }, end(text) { this.body = text } }
  await host.services.route.handler(request, response)
  assert.equal(response.status, 403)
  assert.equal(JSON.parse(response.body).error, 'loopback-only')
})

/** Send one raw request body with fully controlled headers. */
async function raw(services, method, url, headers, body) {
  const payload = body ?? ''
  const request = {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
  const response = { writeHead(status) { this.status = status }, end(text) { this.body = text } }
  await services.route.handler(request, response)
  return { status: response.status, json: JSON.parse(response.body) }
}

test('a non-JSON write is refused before it is parsed', async () => {
  const host = bootHost()
  const refused = await raw(host.services, 'POST', '/skill-menu-studio/save', {
    host: '127.0.0.1:58217',
    'content-type': 'text/plain',
  }, JSON.stringify({ name: 'alpha', hidden: true, alias: '', description: '' }))
  assert.equal(refused.status, 415)
  assert.equal(refused.json.error, 'json-required')
})

test('a cross-origin write is refused', async () => {
  const host = bootHost()
  const refused = await raw(host.services, 'POST', '/skill-menu-studio/save', {
    host: '127.0.0.1:58217',
    'content-type': 'application/json',
    origin: 'http://evil.example',
  }, JSON.stringify({ name: 'alpha', hidden: true, alias: '', description: '' }))
  assert.equal(refused.status, 403)
  assert.equal(refused.json.error, 'cross-origin')

  const accepted = await raw(host.services, 'POST', '/skill-menu-studio/save', {
    host: '127.0.0.1:58217',
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:58217',
  }, JSON.stringify({ name: 'alpha', hidden: true, alias: '', description: '' }))
  assert.equal(accepted.status, 200)
  assert.equal(accepted.json.ok, true)
})

test('hide all and show all are atomic and keep the other overrides', async () => {
  const host = bootHost()
  await call(host.services, 'POST', '/skill-menu-studio/save', {
    name: 'alpha', hidden: false, alias: 'docs', description: 'Docs skill',
  })
  await call(host.services, 'POST', '/skill-menu-studio/order', { order: ['beta', 'alpha', 'gamma'] })
  await call(host.services, 'POST', '/skill-menu-studio/save', {
    name: 'gamma', hidden: true, alias: '', description: '',
  })

  const hidden = await call(host.services, 'POST', '/skill-menu-studio/visibility', { hidden: true })
  assert.equal(hidden.json.ok, true)
  assert.equal(hidden.json.affected, 2, 'only the two user-invocable skills count')
  assert.equal(hidden.json.counts.hidden, 3)
  const listed = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(listed.skills.map((skill) => skill.name), [])

  const state = JSON.parse(readFileSync(join(home, 'skill-menu-studio.json'), 'utf8'))
  assert.equal(state.skills.alpha.alias, 'docs')
  assert.equal(state.skills.alpha.description, 'Docs skill')
  assert.deepEqual(state.order, ['beta', 'alpha', 'gamma'], 'hiding never reorders')

  const shown = await call(host.services, 'POST', '/skill-menu-studio/visibility', { hidden: false })
  assert.equal(shown.json.ok, true)
  assert.equal(shown.json.affected, 2)
  assert.equal(shown.json.counts.hidden, 0)
  const after = JSON.parse(readFileSync(join(home, 'skill-menu-studio.json'), 'utf8'))
  assert.equal(after.skills.gamma, undefined, 'a hidden-only record is removed with the flag')
  const restored = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(restored.skills.map((skill) => skill.name), ['beta', 'docs'])
  assert.equal(restored.skills[1].description, 'Docs skill')
})

test('a visibility request must declare a boolean', async () => {
  const host = bootHost()
  const refused = await call(host.services, 'POST', '/skill-menu-studio/visibility', { hidden: 'yes' })
  assert.equal(refused.status, 400)
  assert.equal(refused.json.error, 'invalid-visibility')
})

test('disposing the plugin restores the original skills/list method', async () => {
  const host = bootHost()
  for (const dispose of host.effects) dispose()
  const value = await host.catalogService.list({ sessionId: 's1' })
  assert.deepEqual(value.skills.map((skill) => skill.name), ['alpha', 'beta'])
  assert.equal(host.services.route, undefined)
})
