// Browser half of the Skill menu bundle: a left-sidebar panel that controls how
// skills appear in the composer's `/` slash menu.
//
// Hand-written in the lazy-CJS bundle protocol (`window.__ModuleLoader__.load`
// with a factory returning cordis-plugin exports), so there is no build step.
// The only runtime module it needs is React from the shell's frozen table.
//
// The page owns presentation and form state only. Its Host half owns the truth:
// the display-state file, the merged skill catalog behind `/skill-menu-studio`,
// and the overlay applied to the `skills/list` catalog the slash menu reads.
// Every visible string goes through the client locale service under this
// plugin's namespace.
window.__ModuleLoader__.load({
  id: '@local/skill-menu-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'skill-menu-studio'
    const PANEL_ID = 'skill-menu'
    const API = '/skill-menu-studio'
    const MAX_ALIAS = 64
    const MAX_DESCRIPTION = 400
    const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

    const ZH = {
      panel: '技能菜单',
      title: '技能菜单',
      subtitle: '管理技能在斜杠菜单中的显示方式。这里只改显示：技能本身、调用方式与提示词都不受影响。',
      searchPlaceholder: '搜索名称或描述',
      filterAll: '全部',
      filterLabel: '筛选',
      filterShown: '显示中',
      filterHidden: '已隐藏',
      refresh: '刷新',
      refreshTitle: '重新读取技能目录',
      resetAll: '恢复默认',
      resetConfirm: '确认恢复',
      resetCancel: '取消',
      resetAria: '恢复所有显示设置为默认',
      counts: '共 {total} 个技能 · {hidden} 个已隐藏 · {renamed} 个已改名',
      loading: '正在读取技能目录…',
      empty: '没有找到技能。检查技能根目录后刷新。',
      noMatches: '没有匹配的技能。',
      loadFailed: '读取技能目录失败：{detail}',
      retry: '重试',
      unpatched: '未能接管斜杠菜单目录（skills/list 不可用），下面的显示设置不会生效。',
      noticeReset: '显示设置文件无法解析，已重置为默认值。',
      noticeUnreadable: '显示设置文件无法读取，本次从默认值开始。',
      noticeInvalid: '显示设置中有无效条目，已跳过。',
      noticeUnwritable: '显示设置无法写入，改动只在本次运行内有效。',
      toggleShow: '在斜杠菜单中显示',
      toggleHide: '从斜杠菜单中隐藏',
      edit: '编辑',
      editing: '收起',
      save: '保存',
      saving: '保存中…',
      cancel: '取消',
      fieldAlias: '斜杠命令名',
      fieldAliasHint: '只能用小写字母、数字和连字符（例如 doc-writer）；留空则保持原名，/原名 始终可用。',
      originalName: '原名 {name}',
      reorderLockedHint: '清空搜索并切换到「全部」后可调整顺序。',
      movedTo: '已移动到第 {n} 位',
      noChanges: '没有需要保存的修改',
      finishCurrentEdit: '请先保存或取消当前编辑。',
      resetWipe: '恢复默认会清除所有改名、描述、隐藏状态和自定义顺序。',
      orderCustom: ' · 已自定义顺序',
      showAll: '全部显示',
      hideAll: '全部隐藏',
      confirmHideAll: '确认隐藏 {n} 个',
      hideAllWarning: '只影响斜杠菜单显示；/名称 仍可调用，模型目录不变。',
      hideAllDone: '已隐藏全部 {n} 个技能；仍可用 /名称 直接调用',
      showAllDone: '已恢复显示 {n} 个技能',
      showAllTitle: '把所有技能恢复显示在斜杠菜单中',
      hideAllTitle: '从斜杠菜单隐藏所有技能',
      noHiddenSkills: '当前没有已隐藏的技能',
      noVisibleSkills: '当前没有可隐藏的技能',
      dismissNotice: '关闭提示',
      fieldAliasPlaceholder: '例如 doc-writer',
      fieldDescription: '描述',
      fieldDescriptionHint: '斜杠菜单中显示的第二行说明，留空则用原始描述。',
      fieldDescriptionPlaceholder: '这项技能适合什么时候使用',
      renamed: '已改名',
      hiddenChip: '已隐藏',
      modelOnly: '仅模型',
      modelOnlyHint: '该技能未开放给用户调用（user-invocable: false），不会出现在斜杠菜单中。',
      orderUp: '上移',
      orderDown: '下移',
      orderLocked: '清空搜索并切换到「全部」后可调整顺序',
      source: '来源',
      presetLabel: '预设',
      saved: '已保存',
      resetDone: '已恢复默认显示',
      failed: '操作失败：{detail}',
      errAliasInvalid: '显示名称只能由小写字母、数字和连字符组成。',
      errAliasSame: '显示名称与原名相同，无需修改。',
      errAliasTaken: '这个名称已被其他技能占用。',
      errDescriptionTooLong: '描述最多 {max} 个字符。',
      errUnknownSkill: '这个技能已不存在，请刷新后再试。',
      errWriteFailed: '设置文件写入失败。',
      errCatalogUnavailable: '暂时无法读取技能目录，请稍后重试。',
      errNetwork: '无法连接本机插件服务，请重启 DSH 后再试。',
      note: '隐藏或改名只影响斜杠菜单的显示与顺序；直接输入 /原名 仍会加载该技能，提供给模型的技能目录也保持不变。',
      openSettings: '这些设置保存在 {path}',
    }

    const EN = {
      panel: 'Skill menu',
      title: 'Skill menu',
      subtitle: 'Control how skills appear in the slash menu. Only the display changes: the skills, how they load and what the model sees stay the same.',
      searchPlaceholder: 'Search name or description',
      filterAll: 'All',
      filterLabel: 'Filter',
      filterShown: 'Shown',
      filterHidden: 'Hidden',
      refresh: 'Refresh',
      refreshTitle: 'Read the skill catalog again',
      resetAll: 'Reset',
      resetConfirm: 'Confirm reset',
      resetCancel: 'Cancel',
      resetAria: 'Reset every display setting',
      counts: '{total} skills · {hidden} hidden · {renamed} renamed',
      loading: 'Reading the skill catalog…',
      empty: 'No skills found. Check your skill roots, then refresh.',
      noMatches: 'No matching skills.',
      loadFailed: 'Could not read the skill catalog: {detail}',
      retry: 'Retry',
      unpatched: 'The slash-menu catalog could not be wrapped (skills/list is unavailable), so these display settings have no effect.',
      noticeReset: 'The display settings file could not be parsed and was reset.',
      noticeUnreadable: 'The display settings file could not be read; this run starts from defaults.',
      noticeInvalid: 'Some entries in the display settings file were invalid and were skipped.',
      noticeUnwritable: 'Display settings cannot be written; changes last only for this process.',
      toggleShow: 'Show in the slash menu',
      toggleHide: 'Hide from the slash menu',
      edit: 'Edit',
      editing: 'Close',
      save: 'Save',
      saving: 'Saving…',
      cancel: 'Cancel',
      fieldAlias: 'Slash command name',
      fieldAliasHint: 'Lowercase letters, digits and hyphens only (for example doc-writer). Leave empty to keep the original; /original always works.',
      originalName: 'Original: {name}',
      reorderLockedHint: 'Clear the search and choose All to reorder.',
      movedTo: 'Moved to position {n}',
      noChanges: 'Nothing to save yet',
      finishCurrentEdit: 'Save or cancel the open editor first.',
      resetWipe: 'Reset clears every rename, description, hidden state and custom order.',
      orderCustom: ' · custom order',
      showAll: 'Show all',
      hideAll: 'Hide all',
      confirmHideAll: 'Hide {n}',
      hideAllWarning: 'Affects the slash menu only; /name still loads each skill and the model catalog is unchanged.',
      hideAllDone: 'Hid all {n} skills; /name still works for each of them',
      showAllDone: 'Restored {n} skills',
      showAllTitle: 'Show every skill in the slash menu again',
      hideAllTitle: 'Hide every skill from the slash menu',
      noHiddenSkills: 'Nothing is hidden',
      noVisibleSkills: 'Nothing is visible to hide',
      dismissNotice: 'Dismiss',
      fieldAliasPlaceholder: 'for example doc-writer',
      fieldDescription: 'Description',
      fieldDescriptionHint: 'The second line shown in the slash menu; leave empty to use the original description.',
      fieldDescriptionPlaceholder: 'When this skill is the right one to use',
      renamed: 'Renamed',
      hiddenChip: 'Hidden',
      modelOnly: 'Model only',
      modelOnlyHint: 'This skill is not user-invocable, so it never appears in the slash menu.',
      orderUp: 'Move up',
      orderDown: 'Move down',
      orderLocked: 'Clear the search and choose All to reorder',
      source: 'Source',
      presetLabel: 'Presets',
      saved: 'Saved',
      resetDone: 'Default display restored',
      failed: 'Failed: {detail}',
      errAliasInvalid: 'A display name may contain only lowercase letters, digits and hyphens.',
      errAliasSame: 'That is the same as the original name.',
      errAliasTaken: 'Another skill already uses that name.',
      errDescriptionTooLong: 'A description may have at most {max} characters.',
      errUnknownSkill: 'That skill no longer exists. Refresh and try again.',
      errWriteFailed: 'The settings file could not be written.',
      errCatalogUnavailable: 'The skill catalog is not readable right now. Try again shortly.',
      errNetwork: 'Could not reach the plugin service on this machine. Restart DSH and try again.',
      note: 'Hiding or renaming changes only the slash menu; typing /original-name still loads the skill, and the catalog given to the model is unchanged.',
      openSettings: 'Stored in {path}',
    }

    const ICONS = {
      search: ['M7.5 13a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z', 'm11.5 11.5 3 3'],
      refresh: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.8 2.6v3.2h-3.2'],
      reset: ['M2.5 8a5.5 5.5 0 1 0 1.6-3.9', 'M2.2 2.6v3.2h3.2'],
      chevronUp: ['m4 9.5 4-4 4 4'],
      chevronDown: ['m4 6.5 4 4 4-4'],
      check: ['m3.5 8.5 3 3 6-7'],
      close: ['m4.5 4.5 7 7', 'm11.5 4.5-7 7'],
    }

    function renderIcon(key, size) {
      return h(
        'svg',
        {
          width: size || 14,
          height: size || 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        ICONS[key].map((d, index) => h('path', { key: index, d })),
      )
    }

    /** The sidebar row's glyph: a menu list crossed by a slash. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M3.5 4.5h8' }),
        h('path', { d: 'M3.5 10h6' }),
        h('path', { d: 'M3.5 15.5h5' }),
        h('path', { d: 'M15.5 3.5 11 16.5' }),
      )
    }

    const CSS = `
.sms-page {
  height: 100%;
  box-sizing: border-box;
  padding: 0 clamp(20px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 1.5;
}
.sms-shell { display: flex; flex-direction: column; width: 100%; max-width: 880px; height: 100%; min-height: 0; }
.sms-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 28px 0 16px; }
html[data-platform='darwin'] .sms-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.sms-heading { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sms-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.01em; }
.sms-subtitle { margin: 0; max-width: 62ch; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.sms-head-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; flex: 1 1 auto; }
.sms-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 40px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
.sms-body > * { flex: none; }
.sms-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sms-search { position: relative; flex: 1 1 220px; min-width: 160px; display: flex; align-items: center; }
.sms-search svg { position: absolute; left: 10px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.sms-input {
  width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px 0 30px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px);
  font: inherit; outline: none;
}
.sms-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.sms-input:focus-visible { border-color: var(--dsw-alias-border-selected, var(--dsw-alias-brand-primary)); outline: 2px solid var(--dsw-alias-border-selected, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.sms-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-sm, 8px); }
.sms-seg button {
  appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; padding: 4px 10px; border-radius: 6px; cursor: pointer;
}
.sms-seg button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.sms-count { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-left: auto; white-space: nowrap; }
.sms-banner { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--dsw-radius-sm, 8px); border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.sms-banner-warn { border-color: var(--dsw-alias-state-warn-tertiary); background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.sms-banner-action { align-items: center; justify-content: space-between; gap: 12px; }
.sms-banner-close { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.sms-banner-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.sms-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 12px); background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sms-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 14px; border-top: 1px solid var(--dsw-alias-border-l1); align-items: start; }
.sms-row:first-child { border-top: 0; }
.sms-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sms-order { display: flex; flex-direction: column; align-items: center; gap: 1px; padding-top: 1px; }
.sms-position { color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.sms-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sms-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.sms-name { font-size: 14px; font-weight: 550; }
.sms-token { font-family: var(--ds-font-family-code); font-size: 11.5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-markdown-inline-code); padding: 1px 5px; border-radius: 4px; }
.sms-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.sms-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sms-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
.sms-chip { font-size: 11px; line-height: 1; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.sms-chip-muted { color: var(--dsw-alias-label-tertiary); }
.sms-chip-warn { border-color: var(--dsw-alias-state-warn-secondary); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-state-warn-tertiary); }
.sms-actions { display: flex; align-items: center; gap: 6px; padding-top: 1px; }
.sms-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.sms-iconbtn:hover:not(:disabled) { background: var(--dsw-alias-button-ghost-active-hover); color: var(--dsw-alias-label-primary); }
.sms-iconbtn:disabled { opacity: .35; cursor: default; }
.sms-btn {
  appearance: none; display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid transparent;
  font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.sms-btn:disabled { opacity: .5; cursor: default; }
.sms-btn-ghost { background: transparent; color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }
.sms-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.sms-btn-plain { background: transparent; color: var(--dsw-alias-label-secondary); padding: 0 8px; }
.sms-btn-plain:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.sms-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-on-color); }
.sms-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.sms-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-secondary); }
.sms-switch {
  position: relative; flex: none; width: 34px; height: 20px; padding: 0; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2);
  cursor: pointer; transition: background var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease);
}
.sms-switch-on { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.sms-switch-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.25);
  transition: transform var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, ease);
}
.sms-switch-on .sms-switch-thumb { transform: translateX(14px); }
.sms-na { color: var(--dsw-alias-label-tertiary); padding: 0 4px; }
.sms-editor { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 8px; margin: 8px 0 2px 46px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-bg-layer-2); }
.sms-field { display: flex; flex-direction: column; gap: 4px; }
.sms-field > span { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sms-textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; padding: 7px 9px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px);
  font: inherit; outline: none;
}
.sms-textarea:focus-visible { border-color: var(--dsw-alias-border-selected, var(--dsw-alias-brand-primary)); outline: 2px solid var(--dsw-alias-border-selected, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.sms-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sms-hint-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.sms-warnline { margin: 2px 0 0; color: var(--dsw-alias-state-warn-label); font-size: 12px; }
.sms-row-hidden .sms-name { color: var(--dsw-alias-label-secondary); }
.sms-editor-actions { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; margin-top: 2px; padding: 6px 0 2px; background: var(--dsw-alias-bg-layer-2); }
.sms-skeleton { display: flex; flex-direction: column; gap: 1px; }
.sms-skeleton-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) 96px; gap: 12px; padding: 16px 14px; border-top: 1px solid var(--dsw-alias-border-l1); }
.sms-skeleton-row:first-child { border-top: 0; }
.sms-bar { height: 10px; border-radius: 999px; background: var(--dsw-alias-bg-skeleton); animation: sms-pulse 1.4s ease-in-out infinite; }
.sms-bar-wide { width: 38%; }
.sms-bar-line { width: 72%; margin-top: 7px; }
@keyframes sms-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .sms-bar { animation: none; } .sms-switch, .sms-switch-thumb { transition: none; } }
.sms-empty { padding: 40px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.sms-error { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px; }
.sms-note { color: var(--dsw-alias-label-secondary); font-size: 12px; margin: 2px 0 0; }
.sms-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 30;
  max-width: min(420px, calc(100vw - 48px)); padding: 9px 14px; border-radius: 999px;
  background: var(--dsw-alias-toast-bg); color: var(--dsw-alias-toast-label);
  font-size: 12.5px; box-shadow: 0 6px 20px rgba(0,0,0,.18);
}
.sms-toast-error { color: var(--dsw-alias-state-error-primary); }
.sms-toast-done { color: var(--dsw-alias-state-success-primary); }
@media (max-width: 640px) {
  .sms-row { grid-template-columns: 30px minmax(0, 1fr); }
  .sms-actions { grid-column: 2; justify-content: flex-start; }
  .sms-editor { margin-left: 0; }
  .sms-count { margin-left: 0; width: 100%; }
}
`

    /**
     * Translate a Host error code into a localized sentence.
     * @param {Function} t - bound translate function.
     * @param {string} code - Host error code.
     * @param {string} [detail] - optional server detail.
     * @returns {string} the message to show.
     */
    function errorText(t, code, detail) {
      switch (code) {
        case 'alias-invalid': return t('errAliasInvalid')
        case 'alias-same': return t('errAliasSame')
        case 'alias-taken': return t('errAliasTaken')
        case 'description-too-long': return t('errDescriptionTooLong', { max: MAX_DESCRIPTION })
        case 'unknown-skill': return t('errUnknownSkill')
        case 'write-failed': return t('errWriteFailed')
        case 'catalog-unavailable': return t('errCatalogUnavailable')
        case 'loopback-only':
        case 'unknown-route':
        case 'bad-json':
        case 'bad-request':
          return t('failed', { detail: detail || code })
        default:
          return t('failed', { detail: detail || code || 'error' })
      }
    }

    /**
     * Call the Host half over its loopback API.
     * @param {string} route - route below the plugin prefix.
     * @param {object} [body] - JSON body; a GET when absent.
     * @returns {Promise<object>} the parsed response.
     */
    async function api(route, body) {
      const isRead = body === undefined
      let response
      try {
        response = await fetch(`${API}/${route}`, isRead
          ? { method: 'GET' }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      } catch (error) {
        throw { code: 'network', detail: String(error) }
      }
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        throw {
          code: payload && typeof payload.error === 'string' ? payload.error : 'http',
          detail: payload && typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`,
        }
      }
      return payload
    }

    /**
     * The Skill menu management page.
     * @param {object} props - slot props; `t` is the namespace-bound translate function.
     * @returns {object} React element tree.
     */
    function SkillMenuPage(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [status, setStatus] = useState('loading')
      const [data, setData] = useState(null)
      const [failure, setFailure] = useState(null)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState({ alias: '', description: '' })
      const [editError, setEditError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [confirmReset, setConfirmReset] = useState(false)
      const [confirmHideAll, setConfirmHideAll] = useState(false)
      const [bulkNotice, setBulkNotice] = useState(null)
      const [toast, setToast] = useState(null)
      const alive = useRef(true)
      const aliasRef = useRef(null)
      const descriptionRef = useRef(null)

      useEffect(() => () => {
        alive.current = false
      }, [])

      useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 3600)
        return () => clearTimeout(timer)
      }, [toast])

      const load = useCallback(async (force) => {
        setStatus((current) => (current === 'ready' ? 'ready' : 'loading'))
        try {
          const payload = await api(force ? 'skills?refresh=1' : 'skills')
          if (!alive.current) return
          setData(payload)
          setFailure(null)
          setStatus('ready')
        } catch (error) {
          if (!alive.current) return
          setFailure(error)
          setStatus('error')
        }
      }, [])

      useEffect(() => {
        void load(false)
      }, [load])

      useEffect(() => {
        if (editing === null) return
        const field = aliasRef.current
        if (field === null) return
        if (typeof field.scrollIntoView === 'function') {
          field.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
        if (typeof field.focus === 'function') field.focus()
      }, [editing])

      const announce = useCallback((text, kind) => setToast({ text, kind: kind || 'info' }), [])

      const mutate = useCallback(async (route, body, onError) => {
        setBusy(body && typeof body.name === 'string' ? body.name : route)
        try {
          const payload = await api(route, body)
          if (!alive.current) return true
          setData(payload)
          setFailure(null)
          setStatus('ready')
          return true
        } catch (error) {
          if (!alive.current) return false
          const message = errorText(t, error.code, error.detail)
          if (typeof onError === 'function') onError(message)
          else announce(message, 'error')
          return false
        } finally {
          if (alive.current) setBusy(null)
        }
      }, [announce, t])

      const rows = data !== null && Array.isArray(data.skills) ? data.skills : []
      const menuRows = rows.filter((row) => row.userInvocable === true)
      const hideAllCount = menuRows.filter((row) => !row.hidden).length
      const hiddenCount = data === null ? 0 : data.counts.hidden
      const canShowAll = data !== null && hiddenCount > 0
      const canHideAll = data !== null && hideAllCount > 0
      const reorderEnabled = query.trim() === '' && filter === 'all' && busy === null
      const reorderBlocked = !reorderEnabled && busy === null && rows.length > 1
      const editingRow = editing === null ? undefined : rows.find((row) => row.name === editing)
      const dirty = editingRow !== undefined && (
        draft.alias !== (editingRow.alias || '')
        || draft.description !== (editingRow.descriptionOverride ?? editingRow.description)
      )
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        return rows.filter((row) => {
          if (filter === 'hidden' && !row.hidden) return false
          if (filter === 'shown' && row.hidden) return false
          if (needle === '') return true
          return row.displayName.toLowerCase().includes(needle)
            || row.name.toLowerCase().includes(needle)
            || (row.displayDescription || '').toLowerCase().includes(needle)
        })
      }, [rows, filter, query])

      const toggleRow = useCallback(async (row) => {
        const ok = await mutate('save', {
          name: row.name,
          hidden: !row.hidden,
          alias: row.alias || '',
          description: row.descriptionOverride || '',
        })
        if (ok) {
          setBulkNotice(null)
          announce(t('saved'), 'done')
        }
      }, [announce, mutate, t])

      const bulkVisibility = useCallback(async (hidden) => {
        setConfirmHideAll(false)
        setBusy('visibility')
        try {
          const payload = await api('visibility', { hidden })
          if (!alive.current) return
          setData(payload)
          setFailure(null)
          setStatus('ready')
          setBulkNotice(hidden && payload.affected > 0 ? { n: payload.affected } : null)
          announce(t(hidden ? 'hideAllDone' : 'showAllDone', { n: payload.affected }), 'done')
        } catch (error) {
          if (!alive.current) return
          announce(errorText(t, error.code, error.detail), 'error')
        } finally {
          if (alive.current) setBusy(null)
        }
      }, [announce, t])

      const startEdit = useCallback((row) => {
        if (editing !== null && editing !== row.name && dirty) {
          announce(t('finishCurrentEdit'), 'error')
          return
        }
        setEditing(row.name)
        setEditError(null)
        setDraft({
          alias: row.alias || '',
          description: row.descriptionOverride ?? row.description,
        })
      }, [announce, dirty, editing, t])

      const cancelEdit = useCallback(() => {
        setEditing(null)
        setEditError(null)
        setDraft({ alias: '', description: '' })
      }, [])

      const saveEdit = useCallback(async (row) => {
        if (!dirty) return
        const alias = draft.alias.trim()
        if (alias !== '' && !ALIAS_PATTERN.test(alias)) {
          setEditError(t('errAliasInvalid'))
          return
        }
        if (alias === row.name) {
          setEditError(t('errAliasSame'))
          return
        }
        if (draft.description.length > MAX_DESCRIPTION) {
          setEditError(t('errDescriptionTooLong', { max: MAX_DESCRIPTION }))
          return
        }
        const description = draft.description.trim()
        setEditError(null)
        const ok = await mutate('save', {
          name: row.name,
          hidden: row.hidden,
          alias,
          description: description === (row.description || '').trim() ? '' : description,
        }, message => setEditError(message))
        if (ok) {
          setEditing(null)
          setBulkNotice(null)
          announce(t('saved'), 'done')
        }
      }, [announce, dirty, draft, mutate, t])

      const move = useCallback(async (name, delta) => {
        const names = rows.map((row) => row.name)
        const from = names.indexOf(name)
        const to = from + delta
        if (from < 0 || to < 0 || to >= names.length) return
        names.splice(to, 0, names.splice(from, 1)[0])
        const ok = await mutate('order', { order: names })
        if (ok) announce(t('movedTo', { n: to + 1 }), 'done')
      }, [announce, mutate, rows, t])

      const reset = useCallback(async () => {
        setConfirmReset(false)
        setConfirmHideAll(false)
        const ok = await mutate('reset', {})
        if (ok) {
          setBulkNotice(null)
          announce(t('resetDone'), 'done')
        }
      }, [announce, mutate, t])

      const notices = []
      if (data !== null && data.patched === false) notices.push({ key: 'unpatched', text: t('unpatched') })
      if (data !== null && data.notice === 'state-reset') notices.push({ key: 'reset', text: t('noticeReset') })
      if (data !== null && data.notice === 'state-unreadable') notices.push({ key: 'unreadable', text: t('noticeUnreadable') })
      if (data !== null && data.notice === 'invalid-entry') notices.push({ key: 'invalid', text: t('noticeInvalid') })
      if (data !== null && data.notice === 'state-unwritable') notices.push({ key: 'unwritable', text: t('noticeUnwritable') })

      const header = h('header', { className: 'sms-head' },
        h('div', { className: 'sms-heading' },
          h('h1', { className: 'sms-title' }, t('title')),
          h('p', { className: 'sms-subtitle' }, t('subtitle')),
          confirmReset ? h('p', { className: 'sms-warnline', role: 'status' }, t('resetWipe')) : null,
          confirmHideAll
            ? h('p', { className: 'sms-warnline', role: 'status' }, t('hideAllWarning'))
            : null,
        ),
        h('div', { className: 'sms-head-actions' },
          confirmHideAll
            ? [
              h('button', {
                key: 'confirm-hide',
                type: 'button',
                className: 'sms-btn sms-btn-danger',
                onClick: () => { void bulkVisibility(true) },
                disabled: busy !== null,
              }, t('confirmHideAll', { n: hideAllCount })),
              h('button', {
                key: 'cancel-hide',
                type: 'button',
                className: 'sms-btn sms-btn-plain',
                onClick: () => setConfirmHideAll(false),
              }, t('resetCancel')),
            ]
            : [
              h('button', {
                key: 'show-all',
                type: 'button',
                className: 'sms-btn sms-btn-ghost',
                onClick: () => { void bulkVisibility(false) },
                disabled: busy !== null || !canShowAll,
                title: canShowAll ? t('showAllTitle') : t('noHiddenSkills'),
              }, t('showAll')),
              h('button', {
                key: 'hide-all',
                type: 'button',
                className: 'sms-btn sms-btn-ghost',
                onClick: () => {
                  setConfirmReset(false)
                  setConfirmHideAll(true)
                },
                disabled: busy !== null || !canHideAll,
                title: canHideAll ? t('hideAllTitle') : t('noVisibleSkills'),
              }, t('hideAll')),
              h('button', {
                key: 'refresh',
                type: 'button',
                className: 'sms-btn sms-btn-ghost',
                onClick: () => { void load(true) },
                disabled: busy !== null,
                title: t('refreshTitle'),
              }, renderIcon('refresh', 13), t('refresh')),
              confirmReset
                ? [
                  h('button', {
                    key: 'confirm',
                    type: 'button',
                    className: 'sms-btn sms-btn-danger',
                    onClick: () => { void reset() },
                    disabled: busy !== null,
                  }, t('resetConfirm')),
                  h('button', {
                    key: 'cancel',
                    type: 'button',
                    className: 'sms-btn sms-btn-plain',
                    onClick: () => setConfirmReset(false),
                  }, t('resetCancel')),
                ]
                : h('button', {
                  key: 'reset',
                  type: 'button',
                  className: 'sms-btn sms-btn-ghost',
                  'aria-label': t('resetAria'),
                  onClick: () => {
                    setConfirmHideAll(false)
                    setConfirmReset(true)
                  },
                  disabled: busy !== null || data === null
                    || (data.counts.overrides === 0 && data.orderCustomized !== true),
                }, renderIcon('reset', 13), t('resetAll')),
            ],
        ),
      )

      const toolbar = h('div', { className: 'sms-toolbar' },
        h('label', { className: 'sms-search' },
          renderIcon('search', 14),
          h('input', {
            className: 'sms-input',
            type: 'search',
            value: query,
            placeholder: t('searchPlaceholder'),
            'aria-label': t('searchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
        ),
        h('div', { className: 'sms-seg', role: 'group', 'aria-label': t('filterLabel') },
          [['all', 'filterAll'], ['shown', 'filterShown'], ['hidden', 'filterHidden']].map(([id, label]) =>
            h('button', {
              key: id,
              type: 'button',
              'aria-pressed': filter === id,
              onClick: () => setFilter(id),
            }, t(label))),
        ),
        h('span', { className: 'sms-count' },
          t('counts', {
            total: data === null ? 0 : data.counts.total,
            hidden: data === null ? 0 : data.counts.hidden,
            renamed: data === null ? 0 : data.counts.renamed,
          }),
          data !== null && data.orderCustomized === true ? t('orderCustom') : ''),
      )

      const reorderHint = reorderBlocked
        ? h('p', { className: 'sms-hint', id: 'sms-reorder-hint' }, t('reorderLockedHint'))
        : null

      const banners = notices.map((notice) =>
        h('div', {
          key: notice.key,
          className: notice.key === 'unpatched' ? 'sms-banner sms-banner-warn' : 'sms-banner',
          role: 'status',
        }, notice.text))

      const bulkBanner = bulkNotice === null
        ? null
        : h('div', { className: 'sms-banner sms-banner-action', role: 'status' },
          h('span', null, t('hideAllDone', { n: bulkNotice.n })),
          h('button', {
            type: 'button',
            className: 'sms-banner-close',
            'aria-label': t('dismissNotice'),
            title: t('dismissNotice'),
            onClick: () => setBulkNotice(null),
          }, renderIcon('close', 12)))

      let body
      if (status === 'loading' && data === null) {
        body = h('div', { className: 'sms-card sms-skeleton', 'aria-hidden': 'true' },
          [0, 1, 2, 3].map((index) => h('div', { className: 'sms-skeleton-row', key: index },
            h('span', { className: 'sms-bar', style: { width: '16px', height: '16px', borderRadius: '50%' } }),
            h('div', null,
              h('div', { className: 'sms-bar sms-bar-wide' }),
              h('div', { className: 'sms-bar sms-bar-line' }),
            ),
            h('div', { className: 'sms-bar', style: { width: '48px', height: '18px', borderRadius: '999px' } }),
          )),
        )
      } else if (status === 'error' && data === null) {
        body = h('div', { className: 'sms-card' },
          h('div', { className: 'sms-error' },
            h('p', { className: 'sms-desc', role: 'alert' },
              t('loadFailed', { detail: failure && failure.code === 'network' ? t('errNetwork') : (failure && failure.detail) || 'error' })),
            h('button', { type: 'button', className: 'sms-btn sms-btn-ghost', onClick: () => { void load(true) } }, t('retry')),
          ),
        )
      } else if (filtered.length === 0) {
        body = h('div', { className: 'sms-card' },
          h('div', { className: 'sms-empty' }, rows.length === 0 ? t('empty') : t('noMatches')),
        )
      } else {
        body = h('div', { className: 'sms-card' }, filtered.map((row, index) => {
          const position = rows.indexOf(row)
          const isEditing = editing === row.name
          const toggleLabel = row.hidden ? t('toggleShow') : t('toggleHide')
          return h('div', { className: row.hidden ? 'sms-row sms-row-hidden' : 'sms-row', key: row.name },
            h('div', { className: 'sms-order' },
              h('button', {
                type: 'button',
                className: 'sms-iconbtn',
                'aria-label': t('orderUp'),
                'aria-describedby': reorderBlocked ? 'sms-reorder-hint' : undefined,
                title: reorderEnabled ? t('orderUp') : t('orderLocked'),
                disabled: !reorderEnabled || position <= 0,
                onClick: () => { void move(row.name, -1) },
              }, renderIcon('chevronUp', 13)),
              h('span', { className: 'sms-position' }, String(position + 1)),
              h('button', {
                type: 'button',
                className: 'sms-iconbtn',
                'aria-label': t('orderDown'),
                'aria-describedby': reorderBlocked ? 'sms-reorder-hint' : undefined,
                title: reorderEnabled ? t('orderDown') : t('orderLocked'),
                disabled: !reorderEnabled || position >= rows.length - 1,
                onClick: () => { void move(row.name, 1) },
              }, renderIcon('chevronDown', 13)),
            ),
            h('div', { className: 'sms-main' },
              h('div', { className: 'sms-line' },
                h('span', { className: 'sms-name' }, row.displayName),
                h('code', { className: 'sms-token' }, `/${row.displayName}`),
                row.alias !== null ? h('span', { className: 'sms-chip' }, t('renamed')) : null,
                row.alias !== null ? h('span', { className: 'sms-chip sms-chip-muted' }, t('originalName', { name: row.name })) : null,
                row.hidden ? h('span', { className: 'sms-chip sms-chip-warn' }, t('hiddenChip')) : null,
                row.userInvocable ? null : h('span', { className: 'sms-chip sms-chip-muted', title: t('modelOnlyHint') }, t('modelOnly')),
              ),
              h('p', { className: 'sms-desc', title: row.displayDescription }, row.displayDescription),
              h('div', {
                className: 'sms-meta',
                title: row.path === null ? undefined : row.path,
              },
                row.source === null ? null : h('span', null, `${t('source')} ${row.source}`),
                row.presets.length === 0 ? null : h('span', null, `${t('presetLabel')} ${row.presets.join(', ')}`),
              ),
            ),
            h('div', { className: 'sms-actions' },
              row.userInvocable
                ? h('button', {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': !row.hidden,
                  'aria-label': toggleLabel,
                  title: toggleLabel,
                  className: row.hidden ? 'sms-switch' : 'sms-switch sms-switch-on',
                  disabled: busy !== null,
                  onClick: () => { void toggleRow(row) },
                }, h('span', { className: 'sms-switch-thumb' }))
                : h('span', { className: 'sms-na', title: t('modelOnlyHint') }, '—'),
              h('button', {
                type: 'button',
                className: 'sms-btn sms-btn-plain',
                onClick: () => (isEditing ? cancelEdit() : startEdit(row)),
                disabled: busy !== null || !row.userInvocable,
              }, isEditing ? t('editing') : t('edit')),
            ),
            isEditing
              ? h('div', { className: 'sms-editor' },
                h('label', { className: 'sms-field' },
                  h('span', null, t('fieldAlias')),
                  h('input', {
                    ref: aliasRef,
                    className: 'sms-input',
                    value: draft.alias,
                    placeholder: row.name || t('fieldAliasPlaceholder'),
                    maxLength: MAX_ALIAS,
                    spellCheck: false,
                    'aria-invalid': editError !== null,
                    'aria-describedby': 'sms-alias-hint',
                    onChange: (event) => {
                      const next = event.target.value
                      setDraft((current) => ({ ...current, alias: next }))
                      if (next.trim() !== '' && !ALIAS_PATTERN.test(next.trim())) setEditError(t('errAliasInvalid'))
                      else setEditError(null)
                    },
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelEdit()
                      } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
                        event.preventDefault()
                        if (typeof descriptionRef.current?.focus === 'function') descriptionRef.current.focus()
                      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        void saveEdit(row)
                      }
                    },
                  }),
                ),
                h('p', { className: 'sms-hint', id: 'sms-alias-hint' }, t('fieldAliasHint')),
                h('label', { className: 'sms-field' },
                  h('span', null, t('fieldDescription')),
                  h('textarea', {
                    ref: descriptionRef,
                    className: 'sms-textarea',
                    rows: 3,
                    value: draft.description,
                    maxLength: MAX_DESCRIPTION,
                    'aria-describedby': 'sms-description-hint',
                    placeholder: t('fieldDescriptionPlaceholder'),
                    onChange: (event) => setDraft((current) => ({ ...current, description: event.target.value })),
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelEdit()
                      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault()
                        void saveEdit(row)
                      }
                    },
                  }),
                ),
                h('p', { className: 'sms-hint', id: 'sms-description-hint' }, t('fieldDescriptionHint')),
                editError === null ? null : h('p', { className: 'sms-hint sms-hint-error', role: 'alert' }, editError),
                h('div', { className: 'sms-editor-actions' },
                  h('button', {
                    type: 'button',
                    className: 'sms-btn sms-btn-primary',
                    disabled: busy !== null || !dirty,
                    title: dirty ? t('save') : t('noChanges'),
                    onClick: () => { void saveEdit(row) },
                  }, busy === row.name ? t('saving') : t('save')),
                  h('button', {
                    type: 'button',
                    className: 'sms-btn sms-btn-plain',
                    onClick: cancelEdit,
                  }, t('cancel')),
                ),
              )
              : null,
          )
        }))
      }

      const footer = h('p', { className: 'sms-note' }, t('note'))

      return h('div', { className: 'sms-page' },
        h('style', null, CSS),
        h('div', { className: 'sms-shell' },
          header,
          h('div', { className: 'sms-body' },
            banners,
            bulkBanner,
            toolbar,
            reorderHint,
            body,
            footer,
          ),
        ),
        toast === null
          ? null
          : h('div', {
            className: `sms-toast sms-toast-${toast.kind}`,
            role: 'status',
            'aria-live': 'polite',
          }, toast.text),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'skill-menu-studio: dictionaries')
        const t = ctx.locale.bind(NS)
        const slots = ctx.slots
        ctx.effect(() => slots.inject('main', () => slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, SkillMenuPage)), 'skill-menu-studio: main panel')
        ctx.effect(() => slots.inject('sidebar.panellist', () => slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 12,
          locale: NS,
          label: () => t('panel'),
        }, PanelIcon)), 'skill-menu-studio: sidebar entry')
      },
    }
  },
})
