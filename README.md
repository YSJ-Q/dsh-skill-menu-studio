# 技能菜单（dsh-skill-menu-studio）

DeepSeek Harness 的左侧栏插件，用来管理技能在输入框 `/` 斜杠菜单里的显示方式。它只改显示：技能本身、加载方式，以及提供给模型的技能目录都不受影响。

仓库：<https://github.com/YSJ-Q/dsh-skill-menu-studio>

## 安装

要求：DeepSeek Harness 的 **Web GUI** profile（插件依赖 harness web server；TUI/headless profile 不会加载）。

### 从 GitHub 安装（当前可用）

- Web：左侧栏「插件」→ 右上「添加插件」→ 输入 `github:YSJ-Q/dsh-skill-menu-studio`。
- 命令行：

  ```bash
  dsh plugin --profile <profile> add github:YSJ-Q/dsh-skill-menu-studio
  ```

安装器会先用 `git ls-remote` 探测 github.com（默认 5 秒超时，且不读取 pnpm 的代理配置），通过后由 pnpm 拉取仓库并选中该 bundle。Git 安装会固定到安装时的提交，之后要升级就重新执行一次 `add`（或先 remove 再 add）；安装 spec 里带完整 40 位 commit 时，管理器才能用 `update` 追踪新提交。

### 从 npm 安装（发布到 npm 之后）

```bash
dsh plugin --profile <profile> add dsh-skill-menu-studio
```

### 本地开发

```bash
dsh plugin --profile <profile> add <本仓库目录>
```

### 卸载

```bash
dsh plugin --profile <profile> remove dsh-skill-menu-studio
```

卸载后状态文件 `<DSH 主目录>/skill-menu-studio.json` 仍会保留；确认不再需要时可手动删除。

## 功能

| 操作 | 效果 |
|---|---|
| 显示 / 隐藏 | 在 `/` 菜单中移除或恢复该条目。技能本身仍可通过 `/原名` 加载。 |
| 全部显示 / 全部隐藏 | 一次作用于菜单中的全部技能：**全部隐藏** 需要二次确认，把每个 user-invocable 技能标记为隐藏；**全部显示** 立即清除所有隐藏标记（包括当前目录未列出的技能）。别名、描述与自定义顺序不受影响，操作后会有提示条报告变更数量。 |
| 斜杠命令名 | 修改菜单中的显示名称与 `/` 命令。改名为 `new-name` 后，通过别名技能仍会加载原技能正文；原名继续可用，并保留在行内显示。 |
| 描述 | 编辑菜单中显示的第二行说明，编辑框预填当前文本；把文本改回原文即撤销覆盖。 |
| 顺序 | 用上移/下移调整菜单顺序，作用于所有预设；仅在列表未筛选时可调整。 |

面板会合并所有 agent 预设与已知工作区中的技能，因此只存在于某个预设或某个项目里的技能也能管理。预设标记为 `user-invocable: false` 的技能显示为 **仅模型** 且不可切换——它们本来就不会进入斜杠菜单。

## 使用

1. 在左侧栏打开 **技能菜单**。
2. 搜索技能，用行内开关显示/隐藏，用 **编辑** 修改斜杠命令名与描述，用上下箭头调整顺序。编辑时 Enter 从名称跳到描述，Ctrl+Enter 保存，Escape 取消。
3. **全部显示** / **全部隐藏** 一次处理所有技能（隐藏前会确认）；**刷新** 在磁盘上增删技能后重新读取目录；**恢复默认**（两步确认）清除所有改名、描述、隐藏状态和自定义顺序。

## 状态保存在哪里

`<DSH 主目录>/skill-menu-studio.json` —— 每个真实技能名一条记录，另加一个顺序数组。文件损坏时会重置为默认值并在面板提示；写入通过同目录临时文件加重命名完成。

## 覆盖层如何工作

- Host 端用保存的状态装饰 `skills/list` 这个 Remote 的返回值（也就是 `/` 菜单背后的目录）。没有其他消费者读取它，所以面向模型的技能目录和 `ctx.skills.get()` 保持不变。
- 覆盖层与别名提供者通过 `ctx.inject` 等待各自的服务就绪，因此与本插件和 session controller 的加载顺序无关。
- 批量显示/隐藏是一次 `POST /visibility` 写入：`{"hidden": true}` 把所有 user-invocable 技能标记为隐藏，`{"hidden": false}` 清除所有隐藏标记。每次写入都是原子的，随后触发一次目录失效。
- 每个被改名的技能由一个全局技能提供者在别名下提供，加载时委托给原技能，因此选中别名与使用原技能完全一致。
- 每次写入后 Host 会发出转发的 `plugin-manager/changed` 事件，输入框的技能来源据此丢弃按 Session 缓存的目录。

## 环境要求与限制

- 需要挂载 harness web server（Web GUI）。面板 API 只响应回环地址请求，写入要求 JSON content type，且请求带有 `Origin` 时必须与 `Host` 一致。
- 在 DSH `0.2.2-rc.5` 上开发与验证。包内没有声明 `engines.dsh`，因此不会被版本检查拦截；更老或更新的 DSH 版本可能存在 API 差异。
- 显示覆盖通过包裹 `sessionSkillCatalog.list` 原型方法实现。如果未来 DSH 版本让该方法不可包裹，面板仍能列出技能并保存设置，但会显示“斜杠菜单覆盖未生效”的警告。
- 别名必须使用 kebab-case，且不能与真实技能名冲突。如果之后新装的技能占用了已有别名，注册表中真实技能会胜出：改名该别名即可恢复预期条目。
- 状态文件损坏会重置为默认值并在面板提示；任何改动都不会静默写入技能文件。

## 测试

```bash
node test/core.test.mjs
node test/host.test.mjs
```

`test/core.test.mjs` 覆盖状态校验、装饰与排序等纯逻辑；`test/host.test.mjs` 用假 Cordis 上下文驱动真实的 `apply()`，在临时 `DSH_HOME` 下验证 API、显示覆盖与别名加载，不会碰真实状态文件。
