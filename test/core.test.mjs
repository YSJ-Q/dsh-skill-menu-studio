import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import {
  MAX_DESCRIPTION,
  aliasEntries,
  applyRecord,
  decorateSkills,
  emptyState,
  isSkillName,
  overviewRows,
  pruneState,
  sanitizeState,
  setOrder,
  setVisibilityForAll,
  summarize,
} from '../core.js'

const catalog = [
  { name: 'alpha', description: 'A skill', path: '/s/alpha/SKILL.md', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, presets: ['standard'] },
  { name: 'beta', description: 'B skill', path: '/s/beta/SKILL.md', source: 'bundled', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true }, presets: ['standard', 'solo'] },
  { name: 'gamma', description: 'C skill', path: null, source: 'bundled', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: false }, presets: [] },
]

const menuCatalog = [
  { name: 'alpha', description: 'A skill', path: '/s/alpha/SKILL.md', modelInvocable: true },
  { name: 'beta', description: 'B skill', path: '/s/beta/SKILL.md', modelInvocable: true },
]

test('skill names follow the kebab-case grammar', () => {
  assert.equal(isSkillName('dsh-doc'), true)
  assert.equal(isSkillName('Doc'), false)
  assert.equal(isSkillName('two words'), false)
  assert.equal(isSkillName(''), false)
  assert.equal(isSkillName(42), false)
})

test('sanitizeState keeps valid records and reports invalid ones', () => {
  const { state, notice } = sanitizeState({
    order: ['beta', 'beta', 'BAD NAME', 'alpha'],
    skills: {
      alpha: { hidden: true, alias: 'docs', description: '  short  ' },
      beta: { alias: 'beta' },
      'not valid': { hidden: true },
      gamma: { hidden: 'yes' },
    },
  })
  assert.equal(notice, 'invalid-entry')
  assert.deepEqual(state.order, ['beta', 'alpha'])
  assert.deepEqual(state.skills.alpha, { hidden: true, alias: 'docs', description: 'short' })
  assert.equal(state.skills.beta, undefined)
  assert.equal(state.skills.gamma, undefined)
})

test('sanitizeState tolerates garbage', () => {
  assert.deepEqual(sanitizeState(null).state, emptyState())
  assert.deepEqual(sanitizeState('nope').state, emptyState())
  assert.deepEqual(sanitizeState([1, 2]).state, emptyState())
})

test('applyRecord stores, renames, and clears a record', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const first = applyRecord(emptyState(), { name: 'alpha', hidden: true, alias: 'docs', description: 'Docs here' }, names)
  assert.ok(first.state, 'expected a state')
  assert.deepEqual(first.state.skills.alpha, { hidden: true, alias: 'docs', description: 'Docs here' })
  assert.deepEqual(first.state.order, [], 'a display record alone does not pin a position')

  const cleared = applyRecord(first.state, { name: 'alpha', hidden: false, alias: '', description: '' }, names)
  assert.deepEqual(cleared.state.skills, {})
})

test('applyRecord rejects bad input', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  assert.equal(applyRecord(emptyState(), { name: 'nope' }, names).error, 'unknown-skill')
  assert.equal(applyRecord(emptyState(), { name: 'Bad Name' }, names).error, 'invalid-name')
  assert.equal(applyRecord(emptyState(), { name: 'alpha', alias: 'Bad Alias' }, names).error, 'alias-invalid')
  assert.equal(applyRecord(emptyState(), { name: 'alpha', alias: 'alpha' }, names).error, 'alias-same')
  assert.equal(applyRecord(emptyState(), { name: 'alpha', alias: 'beta' }, names).error, 'alias-taken')
  assert.equal(applyRecord(emptyState(), { name: 'alpha', description: 'x'.repeat(MAX_DESCRIPTION + 1) }, names).error, 'description-too-long')
})

test('applyRecord rejects an alias another skill already uses', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const first = applyRecord(emptyState(), { name: 'alpha', alias: 'docs' }, names)
  assert.equal(applyRecord(first.state, { name: 'beta', alias: 'docs' }, names).error, 'alias-taken')
})

test('setOrder dedupes and drops invalid names', () => {
  const next = setOrder(emptyState(), ['beta', 'BAD', 'alpha', 'beta'])
  assert.deepEqual(next.order, ['beta', 'alpha'])
  assert.deepEqual(setOrder(emptyState(), 'nope').order, [])
})

test('overviewRows exposes effective display values in configured order', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const state = applyRecord(emptyState(), { name: 'beta', hidden: true, alias: 'b', description: 'Bee' }, names).state
  const ordered = setOrder(state, ['beta', 'alpha', 'gamma'])
  const rows = overviewRows(catalog, ordered)
  assert.deepEqual(rows.map((row) => row.name), ['beta', 'alpha', 'gamma'])
  const beta = rows[0]
  assert.equal(beta.displayName, 'b')
  assert.equal(beta.displayDescription, 'Bee')
  assert.equal(beta.hidden, true)
  assert.equal(beta.descriptionOverride, 'Bee')
  assert.equal(rows[1].displayName, 'alpha')
  assert.equal(rows[1].descriptionOverride, null)
  assert.equal(rows[2].userInvocable, false)
  assert.deepEqual(rows[1].presets, ['standard'])
})

test('decorateSkills hides, renames, re-describes and reorders the menu catalog', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'beta', alias: 'b' }, names).state
  state = applyRecord(state, { name: 'alpha', hidden: true }, names).state
  const decorated = decorateSkills(menuCatalog, state)
  assert.deepEqual(decorated.map((skill) => skill.name), ['b'])
  assert.equal(decorated[0].description.length > 0, true)
  assert.equal(decorated[0].path, '/s/beta/SKILL.md', 'the alias keeps the original path for previews')
  assert.equal(decorated[0].modelInvocable, false, 'the alias stays out of the model catalog')

  const ordered = decorateSkills(menuCatalog, setOrder(state, ['beta']))
  assert.deepEqual(ordered.map((skill) => skill.name), ['b'])
})

test('decorateSkills applies a description to the real entry', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const state = applyRecord(emptyState(), { name: 'alpha', description: 'Better words' }, names).state
  const decorated = decorateSkills(menuCatalog, state)
  assert.deepEqual(decorated.map((skill) => [skill.name, skill.description]), [
    ['alpha', 'Better words'],
    ['beta', 'B skill'],
  ])
})

test('an alias entry already present in the catalog keeps its own row', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const state = applyRecord(emptyState(), { name: 'alpha', alias: 'docs' }, names).state
  const withAlias = [
    ...menuCatalog,
    { name: 'docs', description: 'alias', modelInvocable: false },
  ]
  const decorated = decorateSkills(withAlias, state)
  assert.deepEqual(decorated.map((skill) => skill.name), ['docs', 'beta'])
  assert.equal(decorated[0].path, '/s/alpha/SKILL.md')
})

test('aliasEntries skips hidden skills and supplies a fallback description', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'alpha', alias: 'docs' }, names).state
  state = applyRecord(state, { name: 'beta', alias: 'b', hidden: true }, names).state
  const entries = aliasEntries(state)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].real, 'alpha')
  assert.equal(entries[0].name, 'docs')
  assert.match(entries[0].description, /alpha/)
})

test('pruneState drops records for vanished skills and trims the order', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'alpha', hidden: true }, names).state
  state = applyRecord(state, { name: 'gone', hidden: true }, null).state
  state = setOrder(state, ['alpha', 'gone'])
  const pruned = pruneState(state, catalog)
  assert.equal(pruned.changed, true)
  assert.deepEqual(Object.keys(pruned.state.skills), ['alpha'])
  assert.deepEqual(pruned.state.order, ['alpha'])
  assert.equal(pruneState(pruned.state, catalog).changed, false)
})

test('summarize counts each kind of override', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'alpha', hidden: true, alias: 'docs', description: 'x' }, names).state
  state = applyRecord(state, { name: 'beta', hidden: true }, names).state
  assert.deepEqual(summarize(state), { overrides: 2, hidden: 2, renamed: 1 })
})

test('setVisibilityForAll hides every menu name and keeps other overrides', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'alpha', alias: 'docs', description: 'Docs' }, names).state
  state = applyRecord(state, { name: 'beta', description: 'Bee' }, names).state
  const next = setVisibilityForAll(state, ['alpha', 'beta'], true)
  assert.equal(next.skills.alpha.hidden, true)
  assert.equal(next.skills.alpha.alias, 'docs')
  assert.equal(next.skills.alpha.description, 'Docs')
  assert.equal(next.skills.beta.hidden, true)
  assert.equal(next.skills.beta.description, 'Bee')
  assert.equal(next.skills.gamma, undefined, 'a name outside the menu list is untouched')
  assert.deepEqual(next.order, state.order)
})

test('setVisibilityForAll(false) clears every hidden flag', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  let state = applyRecord(emptyState(), { name: 'alpha', alias: 'docs' }, names).state
  state = applyRecord(state, { name: 'gamma', hidden: true }, names).state
  state = setVisibilityForAll(state, ['alpha', 'beta'], true)
  const next = setVisibilityForAll(state, ['alpha', 'beta'], false)
  assert.equal(next.skills.alpha.hidden, undefined)
  assert.equal(next.skills.alpha.alias, 'docs')
  assert.equal(next.skills.gamma, undefined, 'a hidden-only record disappears with its flag')
  assert.equal(summarize(next).hidden, 0)
})

test('setVisibilityForAll leaves an already-hidden name alone', () => {
  const names = new Set(catalog.map((skill) => skill.name))
  const state = applyRecord(emptyState(), { name: 'alpha', hidden: true, description: 'Docs' }, names).state
  const next = setVisibilityForAll(state, ['alpha', 'beta'], true)
  assert.deepEqual(next.skills.alpha, { hidden: true, description: 'Docs' })
  assert.deepEqual(next.skills.beta, { hidden: true })
})

test('the host and client bundles are syntactically valid', async () => {
  const host = await import('../index.js')
  assert.equal(host.name, 'skill-menu-studio')
  assert.deepEqual(host.inject, ['webServer'])
  assert.equal(typeof host.apply, 'function')
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'client.js' }))
  assert.match(source, /window\.__ModuleLoader__\.load/)
  assert.match(source, /id: '@local\/skill-menu-studio'/)
})
