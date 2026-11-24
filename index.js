/**
 * Host half of the Skill menu bundle.
 *
 * It owns three things and nothing else:
 *
 * 1. A display-state file (`<DSH home>/skill-menu-studio.json`) holding, per
 *    real skill name, `hidden`, `alias`, `description`, plus one global order.
 * 2. A loopback HTTP API on the harness web server that the browser panel reads
 *    and writes; it also merges every agent preset's skill catalog for display,
 *    because a skill can be reachable only inside one preset or one workspace.
 * 3. The display overlay itself: the `skills/list` Remote behind the composer's
 *    `/` menu is decorated with the state, and one global skill provider serves
 *    each alias so `/alias` still loads the original instructions.
 *
 * The overlay is display-only by construction: it never edits skill files,
 * never changes invocation policy, and never touches the model-facing catalog.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  aliasEntries,
  applyRecord,
  decorateSkills,
  emptyState,
  overviewRows,
  pruneState,
  sanitizeState,
  setOrder,
  setVisibilityForAll,
  summarize,
} from './core.js'

export const name = 'dsh-skill-menu-studio'

/** The Web panel needs the harness web server; the skill services are optional. */
export const inject = ['webServer']

/** Route prefix this plugin's API claims on the harness web server. */
const API_PREFIX = '/skill-menu-studio'

/** How long a merged catalog is reused before the panel re-collects it. */
const CACHE_TTL_MS = 15000

/** Hard cap for one request body. */
const BODY_LIMIT = 256 * 1024

/** Provider name the alias skills register under. */
const ALIAS_PROVIDER = 'skill-menu-studio-aliases'

/**
 * Absolute path of the state file.
 * @returns {string} the state-file path.
 */
function stateFilePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'skill-menu-studio.json')
}

/**
 * Read the state file, recovering to an empty state on any failure.
 * @returns {{ state: object, notice: string | null }} persisted display state.
 */
function loadState() {
  let text
  try {
    text = readFileSync(stateFilePath(), 'utf8')
  } catch (error) {
    return { state: emptyState(), notice: error?.code === 'ENOENT' ? null : 'state-unreadable' }
  }
  try {
    return sanitizeState(JSON.parse(text))
  } catch {
    return { state: emptyState(), notice: 'state-reset' }
  }
}

/**
 * Write the state file through a temporary sibling so a crash cannot truncate it.
 * @param {object} state - state to store.
 */
function persistState(state) {
  const file = stateFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

/**
 * Report a contained failure through the harness logger when it exists.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string} message - what failed.
 */
function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[skill-menu-studio] ${message}`)
  } catch {
    // A context without a logger still must not fail its caller.
  }
}

/**
 * Render an arbitrary thrown value as one line.
 * @param {unknown} error - thrown value.
 * @returns {string} printable message.
 */
function messageOf(error) {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unknown error'
  }
}

/**
 * Merge one provider summary into the union catalog.
 * @param {Map<string, object>} merged - accumulating catalog.
 * @param {object} summary - skill summary from the registry.
 * @param {string | null} presetId - preset that reported it, or null for the host layer.
 */
function mergeSkill(merged, summary, presetId) {
  if (typeof summary?.name !== 'string') return
  // The alias provider below feeds `skills.list` so `/alias` resolves; its
  // candidates are display duplicates of rows this panel already owns.
  if (summary.provider === ALIAS_PROVIDER || summary.source === 'display-alias') return
  const existing = merged.get(summary.name)
  if (existing === undefined) {
    merged.set(summary.name, {
      name: summary.name,
      description: typeof summary.description === 'string' ? summary.description : '',
      path: typeof summary.path === 'string' ? summary.path : null,
      source: typeof summary.source === 'string' ? summary.source : null,
      provider: typeof summary.provider === 'string' ? summary.provider : null,
      invocation: {
        modelInvocable: summary.invocation?.modelInvocable === true,
        userInvocable: summary.invocation?.userInvocable === true,
      },
      presets: presetId === null ? [] : [presetId],
    })
    return
  }
  if (existing.description === '' && typeof summary.description === 'string') existing.description = summary.description
  if (existing.path === null && typeof summary.path === 'string') existing.path = summary.path
  existing.invocation.modelInvocable ||= summary.invocation?.modelInvocable === true
  existing.invocation.userInvocable ||= summary.invocation?.userInvocable === true
  if (presetId !== null && !existing.presets.includes(presetId)) existing.presets.push(presetId)
}

/**
 * Candidate working directories whose project skill roots should be visible.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {string[]} warnings - collector diagnostics.
 * @returns {string[]} absolute directories, deduplicated.
 */
function libraryCwds(ctx, warnings) {
  const cwds = []
  try {
    const directory = ctx.get('workingDirectory')?.defaultDirectory
    if (typeof directory === 'string' && directory !== '') cwds.push(directory)
  } catch (error) {
    warnings.push(`default directory: ${messageOf(error)}`)
  }
  try {
    const workspaces = ctx.get('workspaces') ?? ctx.get('workspaceRegistry')
    const list = typeof workspaces?.list === 'function' ? workspaces.list() : []
    for (const workspace of list) {
      const path = workspace?.path ?? workspace?.directory ?? workspace?.root
      if (typeof path === 'string' && path !== '' && !cwds.includes(path)) cwds.push(path)
    }
  } catch (error) {
    warnings.push(`workspaces: ${messageOf(error)}`)
  }
  if (cwds.length === 0) cwds.push(process.cwd())
  return cwds
}

/**
 * Collect every skill reachable by any agent preset in any known workspace.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {object} state - current display state, for the alias fallback rows.
 * @returns {Promise<{ catalog: object[], presets: object[], warnings: string[], complete: boolean }>} merged catalog.
 */
async function collectCatalog(ctx, state) {
  const warnings = []
  const presets = []
  const registry = ctx.get('skills')
  if (registry === undefined) {
    return { catalog: [], presets, warnings: ['the skill registry is not mounted'], complete: false }
  }
  const cwds = libraryCwds(ctx, warnings)
  const targets = [{ id: null, name: null }]
  let registryPresets
  try {
    registryPresets = ctx.get('agentPresets')
  } catch {
    registryPresets = undefined
  }
  if (registryPresets !== undefined && typeof registryPresets.list === 'function') {
    try {
      for (const preset of await registryPresets.list()) {
        presets.push({ id: preset.id, name: preset.name ?? preset.id, broken: typeof preset.broken === 'string' })
        if (typeof preset.broken === 'string') {
          warnings.push(`preset ${preset.id}: ${preset.broken}`)
          continue
        }
        targets.push({ id: preset.id, name: preset.name ?? preset.id })
      }
    } catch (error) {
      warnings.push(`presets: ${messageOf(error)}`)
    }
  }

  const merged = new Map()
  let complete = true
  for (const target of targets) {
    let lease
    if (target.id !== null) {
      try {
        lease = await registryPresets.acquireScope(target.id)
      } catch (error) {
        complete = false
        warnings.push(`preset ${target.id}: ${messageOf(error)}`)
        continue
      }
    }
    try {
      for (const cwd of cwds) {
        try {
          const list = await registry.list({
            cwd,
            ...(lease === undefined ? {} : { scope: lease.key }),
          })
          for (const summary of list) mergeSkill(merged, summary, target.id)
        } catch (error) {
          complete = false
          warnings.push(`${target.name ?? 'host'} @ ${cwd}: ${messageOf(error)}`)
        }
      }
    } finally {
      if (lease !== undefined) {
        try {
          await lease[Symbol.asyncDispose]()
        } catch (error) {
          warnings.push(`preset ${target.id}: ${messageOf(error)}`)
        }
      }
    }
  }
  // Only real skills are listed: an alias is an attribute of its row, not a
  // second row, and a stale alias (its skill gone from an incomplete catalog)
  // simply stays invisible until a complete collection prunes it.
  return { catalog: [...merged.values()], presets, warnings, complete }
}

/**
 * Read a bounded JSON request body.
 * @param {import('node:http').IncomingMessage} request - HTTP request.
 * @returns {Promise<object>} parsed JSON body.
 */
async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > BODY_LIMIT) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} response - HTTP response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON-serializable body.
 */
function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Whether a request reached this machine over its loopback interface.
 * @param {import('node:http').IncomingMessage} request - HTTP request.
 * @returns {boolean} whether the peer is loopback.
 */
function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('127.')
}

/**
 * Mount the display overlay, the alias provider, and the panel API.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  const loaded = loadState()
  let state = loaded.state
  let notice = loaded.notice
  let cache = null
  let pending = null
  let invalidateAliases = () => {}
  let catalogPatched = false

  /**
   * Replace the live state, persist it, and refresh every display consumer.
   * @param {object} next - next state.
   * @param {string | null} nextNotice - notice to surface, if any.
   */
  const commit = (next, nextNotice = null) => {
    state = next
    notice = nextNotice
    cache = null
    persistState(state)
    invalidateAliases()
    // The `/` source caches its catalog per Session and clears on this forwarded
    // manager invalidation; the display changed, so every open composer re-reads.
    try {
      ctx.emit('plugin-manager/changed', { reason: 'plugin' })
    } catch {
      // A host without the forwarded-event plumbing still keeps the saved state.
    }
  }

  /**
   * Build the panel's overview from a fresh collection.
   * @returns {Promise<object>} overview payload.
   */
  const buildOverview = async () => {
    const collected = await collectCatalog(ctx, state)
    if (collected.complete) {
      const pruned = pruneState(state, collected.catalog)
      if (pruned.changed) {
        state = pruned.state
        try {
          persistState(state)
        } catch (error) {
          warn(ctx, `state prune failed: ${messageOf(error)}`)
          notice = 'state-unwritable'
        }
        invalidateAliases()
      }
    }
    const counters = summarize(state)
    const rows = overviewRows(collected.catalog, state)
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      patched: catalogPatched,
      statePath: stateFilePath(),
      notice,
      presets: collected.presets,
      warnings: collected.warnings,
      complete: collected.complete,
      orderCustomized: state.order.length > 0,
      counts: {
        total: rows.length,
        hidden: counters.hidden,
        renamed: counters.renamed,
        overrides: counters.overrides,
      },
      skills: rows,
    }
  }

  /**
   * Read the (cached) overview.
   * @param {boolean} force - bypass the cache.
   * @returns {Promise<object>} overview payload.
   */
  const getOverview = async (force) => {
    if (!force && cache !== null && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
    if (pending !== null) return pending
    pending = buildOverview()
      .then((value) => {
        cache = { at: Date.now(), value }
        return value
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  /**
   * The catalog names a save may address; read without a full panel payload.
   * @returns {Promise<Set<string>>} known skill names.
   */
  const knownNames = async () => {
    try {
      const overview = await getOverview(false)
      return new Set(overview.skills.map((row) => row.name))
    } catch (error) {
      warn(ctx, `catalog read failed: ${messageOf(error)}`)
      return null
    }
  }

  // ── the display overlay on the `/` skill catalog ──────────────────────────

  /**
   * Wrap the session skill catalog once `sessionSkillCatalog` is available.
   * Activation order is not guaranteed: the session controller may mount after
   * this plugin, so the overlay waits for the service instead of sampling it at
   * apply time.
   * @param {import('@deepseek-ai/cordis').Context} target - child context owning the service.
   */
  const installCatalogOverlay = (target) => {
    const service = target.get('sessionSkillCatalog')
    if (service === undefined || typeof service.list !== 'function') return
    let prototype
    try {
      prototype = Object.getPrototypeOf(service)
    } catch {
      prototype = undefined
    }
    const original = prototype?.list
    if (typeof original !== 'function') return
    const patched = async function patchedSkillList(request, signal) {
      const value = await original.call(this, request, signal)
      try {
        if (value === null || typeof value !== 'object' || !Array.isArray(value.skills)) return value
        return { ...value, skills: decorateSkills(value.skills, state) }
      } catch (error) {
        warn(ctx, `catalog decoration failed: ${messageOf(error)}`)
        return value
      }
    }
    try {
      Object.defineProperty(prototype, 'list', {
        value: patched,
        writable: true,
        enumerable: false,
        configurable: true,
      })
      catalogPatched = true
      target.effect(() => () => {
        catalogPatched = false
        try {
          if (prototype.list === patched) {
            Object.defineProperty(prototype, 'list', {
              value: original,
              writable: true,
              enumerable: false,
              configurable: true,
            })
          }
        } catch (error) {
          warn(ctx, `catalog overlay restore failed: ${messageOf(error)}`)
        }
      }, 'skill-menu-studio: slash catalog overlay')
    } catch (error) {
      warn(ctx, `slash catalog is not patchable: ${messageOf(error)}`)
    }
  }

  ctx.inject(['sessionSkillCatalog'], (target) => {
    installCatalogOverlay(target)
  })

  // ── alias skills: `/alias` loads the original instructions ────────────────

  /**
   * Register the alias provider once `skills` is available.
   * @param {import('@deepseek-ai/cordis').Context} target - child context owning the registry.
   */
  const installAliasProvider = (target) => {
    const registry = target.get('skills')
    if (registry === undefined || typeof registry.registerProvider !== 'function') return
    const provider = {
      name: ALIAS_PROVIDER,
      list() {
        return Promise.resolve(aliasEntries(state).map((entry) => ({
          name: entry.name,
          description: entry.description,
          invocation: { modelInvocable: false, userInvocable: true },
          source: 'display-alias',
          provider: ALIAS_PROVIDER,
          rank: 900,
          locator: { real: entry.real },
        })))
      },
      async get(candidate, options) {
        const real = candidate?.locator?.real
        if (typeof real !== 'string') return undefined
        const definition = await registry.get(real, options)
        if (definition === undefined) return undefined
        const record = state.skills[real]
        return {
          ...definition,
          name: candidate.name,
          description: record?.description ?? definition.description,
        }
      },
    }
    target.effect(() => {
      const dispose = registry.registerProvider((control) => {
        invalidateAliases = () => {
          try {
            control.invalidate()
          } catch (error) {
            warn(ctx, `alias invalidation failed: ${messageOf(error)}`)
          }
        }
        return provider
      })
      return () => {
        invalidateAliases = () => {}
        dispose()
      }
    }, 'skill-menu-studio: alias provider')
  }

  ctx.inject(['skills'], (target) => {
    installAliasProvider(target)
  })

  // ── the panel API ─────────────────────────────────────────────────────────

  /**
   * Save one skill's display record.
   * @param {object} input - requested record.
   * @returns {Promise<object>} overview response.
   */
  const saveRecord = async (input) => {
    const names = await knownNames()
    if (names === null) {
      await getOverview(true).catch(() => undefined)
      return { ok: false, error: 'catalog-unavailable' }
    }
    const applied = applyRecord(state, input, names)
    if (applied.error !== undefined) return { ok: false, error: applied.error }
    try {
      commit(applied.state)
    } catch (error) {
      return { ok: false, error: 'write-failed', message: messageOf(error) }
    }
    return getOverview(true)
  }

  const handler = async (request, response) => {
    if (!isLoopback(request)) {
      sendJson(response, 403, { ok: false, error: 'loopback-only' })
      return
    }
    if (request.method === 'POST') {
      // A JSON content type forces a CORS preflight for any page that is not
      // this origin, and a presented Origin must still match the Host it
      // reached. Together they keep a stray local page from writing settings.
      const contentType = request.headers['content-type'] ?? ''
      if (!contentType.toLowerCase().startsWith('application/json')) {
        sendJson(response, 415, { ok: false, error: 'json-required' })
        return
      }
      const origin = request.headers.origin
      if (typeof origin === 'string' && origin !== '') {
        let originHost
        try {
          originHost = new URL(origin).host
        } catch {
          originHost = undefined
        }
        if (originHost === undefined || originHost !== request.headers.host) {
          sendJson(response, 403, { ok: false, error: 'cross-origin' })
          return
        }
      }
    }
    let url
    try {
      url = new URL(request.url ?? '/', 'http://127.0.0.1')
    } catch {
      sendJson(response, 400, { ok: false, error: 'bad-request' })
      return
    }
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    try {
      if (route === '/skills' && (request.method === 'GET' || request.method === 'POST')) {
        sendJson(response, 200, await getOverview(url.searchParams.get('refresh') === '1'))
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (route === '/save') {
        sendJson(response, 200, await saveRecord(await readJsonBody(request)))
        return
      }
      if (route === '/order') {
        const body = await readJsonBody(request)
        if (!Array.isArray(body.order)) {
          sendJson(response, 400, { ok: false, error: 'invalid-order' })
          return
        }
        try {
          commit(setOrder(state, body.order))
        } catch (error) {
          sendJson(response, 500, { ok: false, error: 'write-failed', message: messageOf(error) })
          return
        }
        sendJson(response, 200, await getOverview(true))
        return
      }
      if (route === '/visibility') {
        const body = await readJsonBody(request)
        if (typeof body.hidden !== 'boolean') {
          sendJson(response, 400, { ok: false, error: 'invalid-visibility' })
          return
        }
        let overview
        try {
          overview = await getOverview(true)
        } catch (error) {
          sendJson(response, 500, { ok: false, error: 'catalog-unavailable', message: messageOf(error) })
          return
        }
        const menuRows = overview.skills.filter((row) => row.userInvocable)
        const affected = body.hidden
          ? menuRows.filter((row) => !row.hidden).length
          : menuRows.filter((row) => row.hidden).length
        const menuNames = menuRows.map((row) => row.name)
        try {
          commit(setVisibilityForAll(state, menuNames, body.hidden))
        } catch (error) {
          sendJson(response, 500, { ok: false, error: 'write-failed', message: messageOf(error) })
          return
        }
        sendJson(response, 200, { ...(await getOverview(true)), affected })
        return
      }
      if (route === '/reset') {
        try {
          commit(emptyState(), null)
        } catch (error) {
          sendJson(response, 500, { ok: false, error: 'write-failed', message: messageOf(error) })
          return
        }
        sendJson(response, 200, await getOverview(true))
        return
      }
      if (route === '/refresh') {
        sendJson(response, 200, await getOverview(true))
        return
      }
      sendJson(response, 404, { ok: false, error: 'unknown-route' })
    } catch (error) {
      sendJson(response, 400, { ok: false, error: 'bad-json', message: messageOf(error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
    'skill-menu-studio: panel API',
  )
}

export default { name, inject, apply }
