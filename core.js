/**
 * Pure logic shared by the Host half, the browser half's tests, and the state
 * file: the persisted shape, validation, slash-menu decoration, and alias
 * candidates. No Node.js and no Cordis imports, so it stays trivially testable.
 *
 * The model of the feature: a skill's *identity* belongs to the skill registry
 * (its name is the `/name` token the host loads). This module only ever
 * rewrites the metadata one display consumer sees — the `skills/list` catalog
 * behind the composer's `/` menu — plus one alias skill per renamed entry, so a
 * renamed token still resolves to the original instructions.
 */

/** Current state-file schema version. */
export const STATE_VERSION = 1

/** Longest accepted display description, in characters. */
export const MAX_DESCRIPTION = 400

/** Longest accepted alias, in characters. */
const MAX_NAME = 64

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Whether a string is a valid kebab-case skill (or alias) name.
 * @param {unknown} value - candidate value.
 * @returns {boolean} whether the value can address a skill.
 */
export function isSkillName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME && SKILL_NAME.test(value)
}

/**
 * A fresh, empty display state.
 * @returns {{ version: number, order: string[], skills: Record<string, { hidden?: true, alias?: string, description?: string }> }} the state.
 */
export function emptyState() {
  return { version: STATE_VERSION, order: [], skills: {} }
}

/**
 * Copy a state so callers never mutate the live object.
 * @param {{ version: number, order: string[], skills: object }} state - source state.
 * @returns {object} deep-enough copy.
 */
function cloneState(state) {
  const skills = {}
  for (const [name, record] of Object.entries(state.skills)) skills[name] = { ...record }
  return { version: STATE_VERSION, order: [...state.order], skills }
}

/**
 * Read an arbitrary parsed value as state, dropping anything malformed instead
 * of failing the whole file.
 * @param {unknown} raw - parsed JSON or anything else.
 * @returns {{ state: object, notice: string | null }} the sanitized state.
 */
export function sanitizeState(raw) {
  const state = emptyState()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state, notice: null }
  let notice = null
  const rawOrder = raw.order
  if (Array.isArray(rawOrder)) {
    for (const item of rawOrder) {
      if (isSkillName(item) && !state.order.includes(item)) state.order.push(item)
    }
  }
  const rawSkills = raw.skills
  if (rawSkills !== null && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
    for (const [name, record] of Object.entries(rawSkills)) {
      if (!isSkillName(name)) {
        notice = 'invalid-entry'
        continue
      }
      const clean = {}
      if (record !== null && typeof record === 'object') {
        if (record.hidden === true) clean.hidden = true
        if (isSkillName(record.alias) && record.alias !== name) clean.alias = record.alias
        if (typeof record.description === 'string' && record.description.trim() !== '') {
          clean.description = record.description.trim().slice(0, MAX_DESCRIPTION)
        }
      }
      if (Object.keys(clean).length > 0) state.skills[name] = clean
    }
  }
  return { state, notice }
}

/**
 * Replace one skill's display record from a UI request.
 * @param {object} state - current state.
 * @param {{ name?: unknown, hidden?: unknown, alias?: unknown, description?: unknown }} input - requested record.
 * @param {Set<string> | null} catalogNames - every real skill name currently discoverable.
 * @returns {{ state: object } | { error: string }} the next state or a failure code.
 */
export function applyRecord(state, input, catalogNames) {
  const name = input === null || typeof input !== 'object' ? undefined : input.name
  if (!isSkillName(name)) return { error: 'invalid-name' }
  if (catalogNames !== null && !catalogNames.has(name)) return { error: 'unknown-skill' }
  const next = cloneState(state)
  const record = {}
  if (input.hidden === true) record.hidden = true
  const alias = typeof input.alias === 'string' ? input.alias.trim() : ''
  if (alias !== '') {
    if (!isSkillName(alias)) return { error: 'alias-invalid' }
    if (alias === name) return { error: 'alias-same' }
    if (catalogNames !== null && catalogNames.has(alias)) return { error: 'alias-taken' }
    for (const [other, otherRecord] of Object.entries(next.skills)) {
      if (other !== name && otherRecord.alias === alias) return { error: 'alias-taken' }
    }
    record.alias = alias
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description !== '') {
    if (description.length > MAX_DESCRIPTION) return { error: 'description-too-long' }
    record.description = description
  }
  if (Object.keys(record).length === 0) delete next.skills[name]
  else next.skills[name] = record
  return { state: next }
}

/**
 * Store a complete ordering, dropping invalid and duplicate names.
 * @param {object} state - current state.
 * @param {unknown} names - ordered real skill names.
 * @returns {object} the next state.
 */
export function setOrder(state, names) {
  const next = cloneState(state)
  const seen = new Set()
  const order = []
  if (Array.isArray(names)) {
    for (const name of names) {
      if (!isSkillName(name) || seen.has(name)) continue
      seen.add(name)
      order.push(name)
    }
  }
  next.order = order
  return next
}

/**
 * The rows one management page renders: every discovered skill with its
 * effective display values.
 * @param {ReadonlyArray<object>} catalog - merged skill summaries with `presets`.
 * @param {object} state - current display state.
 * @returns {Array<object>} display rows ordered by configured position.
 */
export function overviewRows(catalog, state) {
  const positions = new Map(state.order.map((name, index) => [name, index]))
  const rows = catalog.map((skill) => {
    const record = state.skills[skill.name]
    const alias = record?.alias ?? null
    const description = record?.description ?? null
    return {
      name: skill.name,
      description: skill.description,
      path: skill.path ?? null,
      source: skill.source ?? null,
      provider: skill.provider ?? null,
      modelInvocable: skill.invocation?.modelInvocable === true,
      userInvocable: skill.invocation?.userInvocable === true,
      presets: Array.isArray(skill.presets) ? [...skill.presets] : [],
      hidden: record?.hidden === true,
      alias,
      descriptionOverride: description,
      displayName: alias ?? skill.name,
      displayDescription: description ?? skill.description,
      order: positions.has(skill.name) ? positions.get(skill.name) : null,
    }
  })
  return rows.sort(compareRows)
}

/**
 * Order rows by configured position, then by name.
 * @param {{ order: number | null, name: string }} left - row.
 * @param {{ order: number | null, name: string }} right - row.
 * @returns {number} comparison result.
 */
function compareRows(left, right) {
  const leftOrder = left.order === null ? Infinity : left.order
  const rightOrder = right.order === null ? Infinity : right.order
  if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/**
 * Apply display overrides to the `skills/list` catalog the `/` menu reads.
 * Renamed skills leave their real entry (an alias entry stands in for it), and
 * hidden skills are omitted. Nothing else about the catalog changes.
 * @param {ReadonlyArray<object>} skills - user-invocable catalog entries.
 * @param {object} state - current display state.
 * @returns {Array<object>} decorated catalog entries.
 */
export function decorateSkills(skills, state) {
  const aliasByReal = new Map()
  const realByAlias = new Map()
  for (const [real, record] of Object.entries(state.skills)) {
    if (typeof record.alias !== 'string') continue
    aliasByReal.set(real, record.alias)
    realByAlias.set(record.alias, real)
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const indexByName = new Map(skills.map((skill, index) => [skill.name, index]))
  const positions = new Map(state.order.map((name, index) => [name, index]))
  const rows = []
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index]
    if (aliasByReal.has(skill.name)) continue
    const record = state.skills[skill.name]
    if (record?.hidden === true) continue
    const owner = realByAlias.get(skill.name)
    const ownerRecord = owner === undefined ? undefined : state.skills[owner]
    const realSkill = owner === undefined ? undefined : byName.get(owner)
    const description = (owner === undefined ? record?.description : ownerRecord?.description) ?? skill.description
    const path = realSkill?.path ?? skill.path
    rows.push({
      ...skill,
      description,
      ...(path === undefined || path === null ? {} : { path }),
      modelInvocable: owner === undefined ? skill.modelInvocable : false,
      __position: positions.get(owner ?? skill.name),
      __index: owner === undefined ? index : (indexByName.get(owner) ?? index),
    })
  }
  // The alias skill provider supplies these candidates to the registry in the
  // running Host; synthesizing a missing one keeps the rename working even if
  // that provider was not registered, and never duplicates a supplied entry.
  let synthetic = []
  for (const [real, alias] of aliasByReal.entries()) {
    const record = state.skills[real]
    if (record?.hidden === true) continue
    if (byName.has(alias) || alias === real) continue
    const realSkill = byName.get(real)
    if (realSkill === undefined) continue
    const description = record?.description ?? realSkill.description
    synthetic = [...synthetic, {
      name: alias,
      description,
      ...(realSkill.path === undefined || realSkill.path === null ? {} : { path: realSkill.path }),
      modelInvocable: false,
      __position: positions.get(real),
      __index: indexByName.get(real) ?? skills.length,
    }]
  }
  rows.push(...synthetic)
  rows.sort((left, right) => {
    const leftPosition = left.__position === undefined ? Infinity : left.__position
    const rightPosition = right.__position === undefined ? Infinity : right.__position
    if (leftPosition !== rightPosition) return leftPosition < rightPosition ? -1 : 1
    return left.__index - right.__index
  })
  return rows.map(({ __position, __index, ...skill }) => skill)
}

/**
 * The alias skill candidates the Host registers for renamed entries.
 * @param {object} state - current display state.
 * @returns {Array<{ real: string, name: string, description: string }>} alias records.
 */
export function aliasEntries(state) {
  const entries = []
  for (const [real, record] of Object.entries(state.skills)) {
    if (typeof record.alias !== 'string' || record.hidden === true) continue
    entries.push({
      real,
      name: record.alias,
      description: typeof record.description === 'string' && record.description !== ''
        ? record.description
        : `Slash-menu alias for the ${real} skill`,
    })
  }
  return entries
}

/**
 * Drop records for skills a complete catalog no longer reports, so a deleted
 * skill cannot leave a phantom alias in the menu.
 * @param {object} state - current display state.
 * @param {ReadonlyArray<object>} catalog - complete discovered catalog.
 * @returns {{ state: object, changed: boolean }} pruned state.
 */
export function pruneState(state, catalog) {
  const names = new Set(catalog.map((skill) => skill.name))
  const next = cloneState(state)
  let changed = false
  for (const name of Object.keys(next.skills)) {
    if (names.has(name)) continue
    delete next.skills[name]
    changed = true
  }
  const order = next.order.filter((name) => names.has(name))
  if (order.length !== next.order.length) {
    next.order = order
    changed = true
  }
  return { state: next, changed }
}

/**
 * Summary counters for the page header.
 * @param {object} state - current display state.
 * @returns {{ overrides: number, hidden: number, renamed: number }} counters.
 */
export function summarize(state) {
  let hidden = 0
  let renamed = 0
  for (const record of Object.values(state.skills)) {
    if (record.hidden === true) hidden += 1
    if (typeof record.alias === 'string') renamed += 1
  }
  return { overrides: Object.keys(state.skills).length, hidden, renamed }
}

/**
 * Set the menu visibility of every user-invocable skill at once. Hiding marks
 * each listed name; showing clears `hidden` from every record, so no stored
 * skill stays invisible after "show all". Aliases, descriptions and the order
 * array are untouched in both directions.
 * @param {object} state - current display state.
 * @param {ReadonlyArray<string>} menuNames - names currently offered by the slash menu.
 * @param {boolean} hidden - whether those names should be hidden.
 * @returns {object} the next state.
 */
export function setVisibilityForAll(state, menuNames, hidden) {
  const next = cloneState(state)
  if (!hidden) {
    for (const [name, record] of Object.entries(next.skills)) {
      if (record.hidden !== true) continue
      delete record.hidden
      if (Object.keys(record).length === 0) delete next.skills[name]
    }
    return next
  }
  for (const name of menuNames) {
    if (!isSkillName(name)) continue
    const record = next.skills[name] ?? {}
    if (record.hidden === true) continue
    record.hidden = true
    next.skills[name] = record
  }
  return next
}
