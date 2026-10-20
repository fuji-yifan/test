# OPA 策略示例：agent 工具调用授权（阶段 6 / S3.1）
#
# 启动（Windows PowerShell）：
#   opa.exe run --server --addr 127.0.0.1:8181 D:\frontend\低代码平台\apps\agent\opa\policy.rego
# 查询地址（填进 apps/agent/.env）：
#   POLICY_ENGINE_URL=http://127.0.0.1:8181/v1/data/furmx/tool/decision
#
# 入参由 apps/agent/src/modules/infra/policy-engine.service.ts 发出：
#   {
#     "principal": { "id": "<userId>", "workspaceId": "<workspaceId>" },
#     "resource":  { "kind": "tool", "tool": "<工具名>", "risk": "low|medium|high", "isWrite": true|false },
#     "action":    "<工具名>",
#     "args":      { ...工具参数... }
#   }
# 返回：{ "decision": "allow|warn|requireConfirm|deny", "reason": "<说明>" }
#
# 注意：内置纯规则（harness/policy-rules.ts）始终先跑，最终与这里的结果**取最严者**。

package furmx.tool

# 最严优先：deny > requireConfirm > warn > allow
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
