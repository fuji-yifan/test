# OPA 策略引擎接入指南（阶段 6 / S3.1）

> 适用代码：`apps/agent`。外部 PDP 为 **env-gated**：不配 `POLICY_ENGINE_URL` 时**零外呼**，
> 行为与未接入完全一致；配了才在工具执行前多问一次 OPA。
>
> 本文以 Windows 本机开发（项目目录 `D:\frontend\低代码平台`）为例。
> 接入方式为 **HTTP + 原生 `fetch`**，**不新增任何 npm 依赖**（不使用官方 SDK）。

> **状态：✅ 已落地并本地验证（2026-10-18）**
> - OPA v1.21.2：`D:\EdgeDownloads\OPA\opa.exe`（已加入用户级 PATH）
> - 启动：`pnpm dev:opa`（已并入 `pnpm dev:all`），监听 `127.0.0.1:8181`
> - agent `.env`：`POLICY_ENGINE_URL=http://127.0.0.1:8181/v1/data/furmx/tool/decision`、`POLICY_ENGINE_FAIL_CLOSED=false`
> - 验证：`/health` 正常；`/metrics` 中 `handler="v1/data"` 计数随请求递增；`policy-engine.spec.ts` 单测通过

---

## 1. 调用链与契约

```
ToolGateway.execute / executeConfirmed
   └─ evaluatePolicy()
        ├─ evaluateBuiltinPolicy()   # S3.2 内置纯规则，恒跑、零基建
        └─ PolicyEngineService.check()  # S3.1 外部 PDP，仅配了 URL 才调用
             └─ POST {POLICY_ENGINE_URL}   # 本文接入 OPA
   └─ combineDecisions(builtin, external)  # 取最严者
```

### 1.1 请求体（agent → OPA）

按 OPA Data API 约定，业务上下文必须放在 `input` 字段里：

```json
{
  "input": {
    "principal": { "id": "<userId>", "workspaceId": "<workspaceId>" },
    "resource": {
      "kind": "tool",
      "tool": "<工具名>",
      "risk": "low | medium | high",
      "isWrite": true
    },
    "action": "<工具名>",
    "args": { "...工具参数..." }
  }
}
```

> ⚠️ **平铺发送（不带 `input` 包装）会让 Rego 里的 `input` 为 `undefined`**，所有策略静默不命中。
> 适配器已在 `policy-engine.service.ts` 内固定包装，不必在调用侧处理。

### 1.2 响应体（OPA → agent）

OPA `/v1/data/...` 会把策略返回值包在 `result` 里：

```json
{ "result": { "decision": "requireConfirm", "reason": "destructive-tool" } }
```

适配器同时兼容扁平 `{decision, reason}` 与 `{result: {...}}` 两种形状。

### 1.3 决策语义

| decision | 含义 | 网关行为 |
|---|---|---|
| `allow` | 放行 | 正常执行 |
| `warn` | 仅告警 | 执行，审计 `details.note` 记录原因 |
| `requireConfirm` | 需人工确认 | 走 HITL 确认流程 |
| `deny` | 拒绝 | 不执行，审计 `POLICY_DENIED (<reason>)`，返回 `policy_denied` |

- 与内置规则**取最严者**：`deny (3) > requireConfirm (2) > warn (1) > allow (0)`。
- 网络错误 / 超时 / 非 2xx：默认 **fail-open（allow）**；`POLICY_ENGINE_FAIL_CLOSED=true` 时 **fail-closed（deny）**。
- 响应无合法 `decision`（含 OPA 规则未定义返回 `{}`）：按「无判定」处理 —— 默认放行，fail-closed 时拒绝。
  **生产环境建议开启 `POLICY_ENGINE_FAIL_CLOSED=true`**，避免策略路径写错导致静默放行。

---

## 2. 安装并启动 OPA

### 2.1 下载

官方 Windows 64 位单文件：

```
https://openpolicyagent.org/downloads/latest/opa_windows_amd64.exe
```

重命名为 `opa.exe`。本机实际位置：`D:\EdgeDownloads\OPA\opa.exe`，该目录已加入**用户级 PATH**
（`pnpm dev:opa` 直接按命令名调用；旧终端需重开才生效）。

验证：

```powershell
opa.exe version
# Version: 1.x.x
```

> OPA 官方**没有 npm 服务端包**。npm 上的 `@open-policy-agent/opa` 只是连服务端的客户端 SDK
> （还需额外 `zod` peer 依赖），本项目不需要。

### 2.2 启动

策略文件在仓库内：`apps/agent/opa/policy.rego`。

```powershell
opa.exe run --server --addr 127.0.0.1:8181 -w "D:\frontend\低代码平台\apps\agent\opa\policy.rego"
```

- `--server`：HTTP 服务模式
- `--addr 127.0.0.1:8181`：仅监听本机（开发环境足够）
- `-w` / `--watch`：策略文件变更自动重载，**改 `.rego` 后无需重启**

需要观察 agent 是否发来请求时，追加 `--log-level debug`。

---

## 3. 编写策略

现有示例：`apps/agent/opa/policy.rego`（`package furmx.tool`）。

决策路径：

```
POST http://127.0.0.1:8181/v1/data/furmx/tool/decision
```

最小骨架（**必须返回对象，不能返回裸布尔值**）：

```rego
package furmx.tool

decision := {"decision": "deny", "reason": "workspace-write-locked"} if {
	input.principal.workspaceId == "ws-locked"
	input.resource.isWrite == true
} else := {"decision": "requireConfirm", "reason": "destructive-tool"} if {
	input.action in {"form_delete", "form_version_delete"}
} else := {"decision": "warn", "reason": "pii-access"} if {
	is_array(input.args.fields)
	some field in input.args.fields
	field in {"password", "phone", "idCard", "bankCard", "email"}
} else := {"decision": "allow", "reason": "default-allow"}
```

要点：

- OPA 1.x 默认 Rego v1 语法；`if` / `else` 链按「最严优先」从上到下排列。
- 最后一定要有兜底分支（如 `else := allow`），保证规则始终有定义。
- 返回 `{allow: boolean}` 或裸布尔值**不兼容**本适配器（会被判为「无判定」）。
- 内置规则（删除确认、跨租户拒绝、批量阈值、敏感字段告警）仍会照常跑，
  外部策略只用于叠加更严或业务特有的规则。

---

## 4. 配置 agent

编辑 `apps/agent/.env`：

```dotenv
POLICY_ENGINE_URL=http://127.0.0.1:8181/v1/data/furmx/tool/decision
POLICY_ENGINE_TIMEOUT_MS=2000
POLICY_ENGINE_FAIL_CLOSED=false
```

| 变量 | 说明 |
|---|---|
| `POLICY_ENGINE_URL` | 空 = 不启用外部 PDP（只跑内置规则） |
| `POLICY_ENGINE_TOKEN` | 可选；填了会带 `Authorization: Bearer <token>`（本地 OPA 不需要） |
| `POLICY_ENGINE_TIMEOUT_MS` | 单次决策超时，默认 2000ms |
| `POLICY_ENGINE_FAIL_CLOSED` | `true` = OPA 不可用/响应非法时拒绝；生产建议开启 |

重启 agent 后生效：

```powershell
pnpm dev:agent
```

环境变量完整说明见 `apps/agent/.env.example` 的「外部基建适配」段。

---

## 5. 验证

### 5.1 直接验证 OPA

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8181/v1/data/furmx/tool/decision" `
  -Method Post -ContentType "application/json" `
  -Body '{"input":{"principal":{"id":"u1","workspaceId":"ws1"},"resource":{"kind":"tool","tool":"form_delete","risk":"high","isWrite":true},"action":"form_delete","args":{"formId":"f1"}}}'
```

预期：

```json
{ "result": { "decision": "requireConfirm", "reason": "destructive-tool" } }
```

### 5.2 端到端验证（能看到拒绝）

临时把策略第一条改成对一个只读工具 `deny`：

```rego
decision := {"decision": "deny", "reason": "test-deny"} if {
	input.action == "data_query"
}
```

在对话里触发一次 `data_query`，预期：

- 工具不执行，返回 `policy_denied`；
- 审计出现 `POLICY_DENIED (test-deny)`；
- OPA 加 `--log-level debug` 时可见 agent 发来的查询日志。

验证完把策略改回。

### 5.3 fail-safe 验证

| 场景 | 预期 |
|---|---|
| 停掉 `opa.exe`，`FAIL_CLOSED=false` | 工具照常执行（fail-open），agent 日志出现一次「策略引擎不可用」warn |
| 停掉 `opa.exe`，`FAIL_CLOSED=true` | 工具被拒绝（fail-closed） |
| `POLICY_ENGINE_URL` 指向不可达端口 | 在 `TIMEOUT_MS` 内返回，不会挂起 |
| URL 写成不存在的策略路径 | OPA 返回 `{}` → 视为「无判定」：默认放行；fail-closed 时拒绝 |

---

## 6. 修改策略与回滚

- **改策略**：直接编辑 `apps/agent/opa/policy.rego`，`-w` 模式下 OPA 自动重载；无需重启 agent。
- **临时停用外部 PDP**：清空 `POLICY_ENGINE_URL` 并重启 agent（内置规则继续生效）。
- **完全回退**：清空配置即可，无需改代码、无数据迁移。

---

## 7. 排错清单

| 现象 | 排查 |
|---|---|
| 明明写了 deny 却全部放行 | ① 请求是否带 `{input: ...}`（本仓库已内置）；② URL 路径是否与 `package` + 规则名一致；③ 策略是否返回了 `{decision, reason}` 对象 |
| agent 日志「策略引擎不可用（unreachable）」 | OPA 未启动 / 端口不对 / 被防火墙拦截 |
| agent 日志「策略引擎不可用（http-404）」 | `POLICY_ENGINE_URL` 路径错误（Data API 是 `/v1/data/<package>/<rule>`） |
| 改策略不生效 | 启动时是否带 `-w`；未带则重启 `opa.exe` |
| 返回 `policy_denied` 但不知道原因 | 审计 summary 里有 `POLICY_DENIED (<reason>)`；OPA 端可用 `--log-level debug` |

---

## 8. 涉及文件与验证命令

| 文件 | 作用 |
|---|---|
| `apps/agent/src/modules/infra/policy-engine.service.ts` | HTTP 适配器：`{input:...}` 包装、`result` 解包、fail-open/fail-closed |
| `apps/agent/src/modules/harness/policy-rules.ts` | 内置规则 + 决策合并（取最严） |
| `apps/agent/src/modules/harness/tool-gateway.ts` | 执行前调用策略、deny 时写审计 |
| `apps/agent/opa/policy.rego` | 示例 OPA 策略 |
| `apps/agent/test/policy-engine.spec.ts` | 适配器单测（含 OPA 形状与 `{input}` 包装断言） |

运行单测与类型检查（Windows 侧）：

```powershell
cd D:\frontend\低代码平台\apps\agent
npx vitest run --config vitest.config.mts test/policy-engine.spec.ts
npx tsc --noEmit
```
