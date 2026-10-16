<template>
  <div
    class="process-designer"
    @mousemove="onResizeMove"
    @mouseup="onResizeUp"
    @mouseleave="onResizeUp"
  >
    <!-- ====== 顶部工具栏 ====== -->
    <header class="designer-header">
      <div class="header-left">
        <el-button text @click="goBack">
          <el-icon><ArrowLeft /></el-icon> 返回列表
        </el-button>
      </div>
      <div class="header-center">
        <h2 v-if="definition" class="header-title">{{ definition.name }} — 流程设计</h2>
      </div>
      <div class="header-right">
        <el-button :loading="saving" @click="saveDefinition">保存</el-button>
        <el-button
          v-if="definition?.status === 'draft'"
          type="success"
          :loading="publishing"
          @click="publishDef"
        >发布</el-button>
      </div>
    </header>

    <!-- ====== 三列主体 ====== -->
    <div
      v-if="definition"
      class="designer-body"
    >
      <!-- 第一列：节点面板 -->
      <ProcessNodePalette
        :approval-node-types="approvalNodeTypes"
        :action-node-types="actionNodeTypes"
        :gateway-node-types="gatewayNodeTypes"
        :left-width="leftWidth"
      />

      <!-- 拖拽分隔线 -->
      <div
        class="resize-divider"
        :class="{ active: resizing === 'left' }"
        @mousedown.prevent="onResizeStart('left', $event)"
      ><div class="divider-grip" /></div>

      <!-- 第二列：可视化画布 -->
      <main
        ref="canvasRef"
        class="canvas-area"
        :class="{ 'drag-over': dragOverCanvas }"
        @mousedown="onCanvasMouseDown"
        @mousemove="onCanvasMouseMove"
        @mouseup="onCanvasMouseUp"
        @dragover.prevent="onCanvasDragOver"
        @dragleave="onCanvasDragLeave"
        @drop.prevent="onCanvasDrop"
        @contextmenu.prevent="onCanvasRightClick"
      >
        <!-- SVG 连线层 -->
        <svg
          class="edges-layer"
          :view-box="'0 0 ' + canvasWidth + ' ' + canvasHeight"
          :width="canvasWidth"
          :height="canvasHeight"
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#909399"
              />
            </marker>
            <marker
              id="arrowhead-blue"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <polygon
                points="0 0, 10 3.5, 0 7"
                fill="#409eff"
              />
            </marker>
            <pattern
              id="grid-dot"
              width="15"
              height="15"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="7.5" cy="7.5" r="1" fill="#dcdfe6" />
            </pattern>
            <pattern
              id="grid-line"
              width="15"
              height="15"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 15 0 L 0 0 0 15" fill="none" stroke="#dcdfe6" stroke-width="1" />
            </pattern>
            <pattern
              id="grid-dot-dark"
              width="15"
              height="15"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="7.5" cy="7.5" r="1" fill="#334155" />
            </pattern>
            <pattern
              id="grid-line-dark"
              width="15"
              height="15"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 15 0 L 0 0 0 15" fill="none" stroke="#475569" stroke-width="1" />
            </pattern>
          </defs>
          <rect
            v-if="gridType === 'dot'"
            width="100%"
            height="100%"
            :fill="isDark ? 'url(#grid-dot-dark)' : 'url(#grid-dot)'"
          />
          <rect
            v-if="gridType === 'line'"
            width="100%"
            height="100%"
            :fill="isDark ? 'url(#grid-line-dark)' : 'url(#grid-line)'"
          />
          <path
            v-for="ep in edgePaths"
            :key="ep.id"
            :d="ep.d"
            fill="none"
            :stroke="ep.label ? '#409eff' : '#909399'"
            stroke-width="2"
            :stroke-dasharray="ep.label ? '8 4' : 'none'"
            :marker-end="ep.label ? 'url(#arrowhead-blue)' : 'url(#arrowhead)'"
            :class="{ 'edge-selected': isEdgeSelected(ep) }"
          />
          <!-- 连线标签 -->
          <g
            v-for="ep in edgePaths.filter(e => e.label)"
            :key="'tg' + ep.id"
          >
            <rect
              :x="ep.labelX - ep.labelW / 2 - 4"
              :y="ep.labelY - 9"
              :width="ep.labelW + 8"
              height="18"
              rx="4"
              fill="#fff"
              stroke="#409eff"
              stroke-width="1"
              fill-opacity="0.95"
            />
            <text
              :x="ep.labelX"
              :y="ep.labelY"
              fill="#303133"
              font-size="12"
              font-weight="600"
              text-anchor="middle"
              dominant-baseline="middle"
            >{{ ep.label }}</text>
          </g>
          <!-- 连线临时线 -->
          <path
            v-if="tempLine.show"
            :d="tempLine.d"
            fill="none"
            stroke="#409eff"
            stroke-width="2"
            stroke-dasharray="6 3"
            marker-end="url(#arrowhead-blue)"
            style="pointer-events: none"
          />
        </svg>

        <!-- 节点层 -->
        <div
          class="nodes-layer"
          :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }"
        >
          <div
            v-for="node in nodes"
            :key="node.id"
            :class="nodeClasses(node)"
            :style="nodeStyle(node)"
            @mousedown.stop="onNodeMouseDown($event, node)"
            @click.stop="selectNode(node)"
          >
            <!-- 上端口 -->
            <div
              v-if="node.type !== 'start'"
              class="port port-in"
              @mousedown.stop
              @click.stop="onPortClick(node)"
            />

            <div
              class="node-content"
              :class="{ 'content-rotated': isGateway(node.type) }"
            >
              <el-icon :size="nodeIconSize(node.type)">
                <component :is="nodeTypeIcon(node.type)" />
              </el-icon>
              <span
                v-if="!isCircle(node.type)"
                class="node-name"
              >{{ node.name }}</span>
            </div>

            <!-- 删除按钮 -->
            <span
              v-if="node.type !== 'start' && node.type !== 'end'"
              class="node-delete"
              @click.stop="removeNode(node.id)"
            >&times;</span>

            <!-- 下端口 -->
            <div
              v-if="node.type !== 'end'"
              class="port port-out"
              :class="{ active: connecting && connectSourceId === node.id }"
              @mousedown.stop
              @click.stop="onPortClick(node)"
            />
          </div>
        </div>
      </main>

      <!-- 拖拽分隔线 -->
      <div
        class="resize-divider"
        :class="{ active: resizing === 'right' }"
        @mousedown.prevent="onResizeStart('right', $event)"
      ><div class="divider-grip" /></div>

      <!-- 第三列：属性面板 -->
      <aside class="panel-right" :style="{ width: rightWidth + 'px' }">
        <div class="panel-nav">
          <span
            :class="['nav-item', { active: panelMode === 'canvas' }]"
            @click="panelMode = 'canvas'"
          >画布设置</span>
          <span
            :class="['nav-item', { active: panelMode === 'node' }]"
            @click="switchToNode"
          >节点属性</span>
        </div>

        <!-- ====== 画布设置 ====== -->
        <template v-if="panelMode === 'canvas'">
          <el-form
            label-position="top"
            size="small"
          >
            <h5 class="section-title">
              流程信息
            </h5>
            <el-form-item label="流程名称">
              <el-input
                v-model="definition.name"
                @input="markDirty"
              />
            </el-form-item>
            <el-form-item label="描述">
              <el-input
                v-model="definition.description"
                type="textarea"
                :autosize="{ minRows: 2 }"
                @input="markDirty"
              />
            </el-form-item>
            <el-form-item label="允许撤回">
              <el-switch
                v-model="definition.settings.allowWithdraw"
                @change="markDirty"
              />
            </el-form-item>
            <el-form-item label="允许催办">
              <el-switch
                v-model="definition.settings.allowUrge"
                @change="markDirty"
              />
            </el-form-item>
            <el-form-item label="催办时限 (小时)">
              <el-input-number
                v-model="definition.settings.urgeTimeout"
                :min="1"
                :max="720"
                @change="markDirty"
              />
            </el-form-item>

            <!-- 表单绑定挂在流程的**开始节点**上（start.config），属流程级配置，故放在画布设置里 -->
            <template v-if="startNode">
              <h5 class="section-title">
                关联表单
              </h5>
              <p
                v-if="startNode.config.formId"
                class="form-tip"
              >
                {{ definition?.status === 'published'
                  ? '表单提交后会自动发起本流程'
                  : '流程发布后表单关联生效' }}
              </p>
              <el-form-item>
                <el-select
                  v-model="startNode.config.formId"
                  filterable
                  clearable
                  placeholder="选择表单"
                  @change="onFormBind"
                >
                  <el-option
                    v-for="f in workspaceForms"
                    :key="f.id"
                    :label="f.name"
                    :value="f.id"
                  />
                </el-select>
              </el-form-item>
              <template v-if="startNode.config.formId && formFields.length > 0">
                <h5 class="section-title">
                  流程变量
                </h5>
                <p class="form-tip">
                  勾选字段将作为流程的条件变量使用
                </p>
                <el-form-item>
                  <el-checkbox-group
                    v-model="startNode.config.variables"
                    @change="markDirty"
                  >
                    <div
                      v-for="field in formFields"
                      :key="field.key"
                      style="margin-bottom: 4px"
                    >
                      <el-checkbox
                        :value="field.key"
                        :label="field.key"
                      >
                        <span class="field-label">{{ field.name || field.key }}</span>
                      </el-checkbox>
                    </div>
                  </el-checkbox-group>
                </el-form-item>
              </template>
              <div
                v-else-if="startNode.config.formId && formFields.length === 0"
                class="form-tip"
                style="color:#909399"
              >
                该表单暂无字段
              </div>
            </template>

            <h5 class="section-title">
              画布
            </h5>
            <el-form-item label="画布宽度">
              <el-input-number
                v-model="canvasWidth"
                :min="800"
                :max="4000"
                :step="100"
              />
            </el-form-item>
            <el-form-item label="画布高度">
              <el-input-number
                v-model="canvasHeight"
                :min="400"
                :max="4000"
                :step="100"
              />
            </el-form-item>
            <el-form-item label="背景样式">
              <el-radio-group v-model="gridType">
                <el-radio value="none">
                  空白
                </el-radio>
                <el-radio value="dot">
                  点格
                </el-radio>
                <el-radio value="line">
                  网格
                </el-radio>
              </el-radio-group>
            </el-form-item>

            <div class="canvas-stats">
              <div class="stat-row">
                <span>节点数</span><b>{{ nodes.length }}</b>
              </div>
              <div class="stat-row">
                <span>连线数</span><b>{{ edges.length }}</b>
              </div>
            </div>

            <el-button
              type="danger"
              size="small"
              style="width:100%; margin-top:12px"
              @click="clearAll"
            >
              清空画布
            </el-button>
          </el-form>
        </template>

        <!-- ====== 节点属性 ====== -->
        <template v-if="panelMode === 'node' && selectedNode">
          <h4 class="panel-title">
            {{ nodeTypeLabel(selectedNode.type) }}
          </h4>
          <el-form
            label-position="top"
            size="small"
            class="prop-form"
          >
            <el-form-item label="名称">
              <el-input
                :model-value="selectedNode.name"
                @input="onNodeNameInput"
              >
                <template #suffix>
                  <span
                    v-if="(selectedNode.name || '').length > 6"
                    class="name-overflow"
                  >-{{ (selectedNode.name || '').length - 6 }}</span>
                </template>
              </el-input>
              <div
                v-if="!selectedNode.name?.trim()"
                class="field-warning"
              >
                名称不可为空
              </div>
              <div
                v-else-if="(selectedNode.name || '').length > 6"
                class="field-warning"
              >
                名称过长可能会造成部分文字缺失
              </div>
            </el-form-item>
            <el-form-item label="说明">
              <el-input
                v-model="selectedNode.config.description"
                type="textarea"
                :rows="3"
                placeholder="给节点添加备注说明（可选）"
                @input="markDirty"
              />
            </el-form-item>

            <!-- ====== 审批节点属性 ====== -->
            <template v-if="isApprovalType(selectedNode.type)">
              <h5 class="section-title">
                审批配置
              </h5>
              <el-form-item
                v-if="selectedNode.type !== 'direct-approval' && selectedNode.type !== 'countersign' && selectedNode.type !== 'or-sign'"
                label="审批模式"
              >
                <el-select
                  v-model="selectedNode.config.type"
                  @change="markDirty"
                >
                  <el-option
                    label="单人审批"
                    value="single"
                  />
                  <el-option
                    label="多人审批"
                    value="multi"
                  />
                </el-select>
              </el-form-item>
              <!-- 角色审批多人模式：审批选择 -->
              <template v-if="isRoleApproval(selectedNode.type) && selectedNode.config.type === 'multi'">
                <el-form-item label="审批选择">
                  <el-radio-group
                    v-model="selectedNode.config.approvalMode"
                    @change="onApprovalModeChange"
                  >
                    <el-radio value="assignee">
                      审批人
                    </el-radio>
                    <el-radio value="role">
                      审批角色
                    </el-radio>
                  </el-radio-group>
                </el-form-item>
                <el-form-item
                  v-if="selectedNode.config.approvalMode === 'assignee'"
                  label="审批人"
                >
                  <el-select
                    v-model="selectedNode.config.assignees"
                    multiple
                    filterable
                    clearable
                    placeholder="选择审批人（可多选）"
                    @change="onAssigneesChange"
                  >
                    <el-option
                      v-for="m in workspaceMembers"
                      :key="m.user.id"
                      :label="m.user.nickname || m.user.email"
                      :value="m.user.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item
                  v-if="selectedNode.config.approvalMode === 'role'"
                  label="审批角色"
                >
                  <el-select
                    v-model="selectedNode.config.roleList"
                    multiple
                    filterable
                    clearable
                    placeholder="选择审批角色（可多选）"
                    @change="markDirty"
                  >
                    <el-option
                      v-for="r in workspaceRoles"
                      :key="r.id"
                      :label="r.name"
                      :value="r.name"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="通过策略">
                  <el-select
                    v-model="selectedNode.config.strategy.type"
                    @change="markDirty"
                  >
                    <el-option
                      label="会签（全员通过）"
                      value="all"
                    />
                    <el-option
                      label="或签（任一通过）"
                      value="any"
                    />
                    <el-option
                      label="比例通过"
                      value="ratio"
                    />
                    <el-option
                      label="一票否决"
                      value="veto"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item
                  v-if="selectedNode.config.strategy?.type === 'ratio'"
                  label="通过比例"
                >
                  <el-input-number
                    v-model="selectedNode.config.strategy.ratio"
                    :min="0"
                    :max="1"
                    :step="0.1"
                    @change="markDirty"
                  />
                </el-form-item>
              </template>

              <!-- 角色审批单人模式：选人后反查角色 -->
              <template v-else-if="isRoleApproval(selectedNode.type) && selectedNode.config.type !== 'multi'">
                <el-form-item label="审批人">
                  <el-select
                    :model-value="assigneeSelectValue"
                    filterable
                    clearable
                    placeholder="选择审批人"
                    @update:model-value="onAssigneesChange"
                  >
                    <el-option
                      v-for="m in workspaceMembers"
                      :key="m.user.id"
                      :label="m.user.nickname || m.user.email"
                      :value="m.user.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="审批角色">
                  <el-input
                    v-model="selectedNode.config.role"
                    placeholder="选中审批人后确定"
                    @input="markDirty"
                  />
                </el-form-item>
              </template>

              <!-- 非角色审批：通用审批人选择 -->
              <template v-else>
                <el-form-item label="审批人">
                  <el-select
                    :model-value="assigneeSelectValue"
                    :multiple="isMultiAssign(selectedNode)"
                    filterable
                    clearable
                    :placeholder="isMultiAssign(selectedNode) ? '选择审批人（可多选）' : '选择审批人'"
                    @update:model-value="onAssigneesChange"
                  >
                    <el-option
                      v-for="m in workspaceMembers"
                      :key="m.user.id"
                      :label="m.user.nickname || m.user.email"
                      :value="m.user.id"
                    />
                  </el-select>
                </el-form-item>
                <template v-if="selectedNode.config.type === 'multi'">
                  <el-form-item label="通过策略">
                    <template v-if="selectedNode.type === 'countersign'">
                      <el-tag type="primary">
                        会签（全员通过）
                      </el-tag>
                    </template>
                    <template v-else-if="selectedNode.type === 'or-sign'">
                      <el-tag type="success">
                        或签（任一通过）
                      </el-tag>
                    </template>
                    <template v-else>
                      <el-select
                        v-model="selectedNode.config.strategy.type"
                        @change="markDirty"
                      >
                        <el-option
                          label="会签（全员通过）"
                          value="all"
                        />
                        <el-option
                          label="或签（任一通过）"
                          value="any"
                        />
                        <el-option
                          label="比例通过"
                          value="ratio"
                        />
                        <el-option
                          label="一票否决"
                          value="veto"
                        />
                      </el-select>
                    </template>
                  </el-form-item>
                  <el-form-item
                    v-if="selectedNode.config.strategy?.type === 'ratio'"
                    label="通过比例"
                  >
                    <el-input-number
                      v-model="selectedNode.config.strategy.ratio"
                      :min="0"
                      :max="1"
                      :step="0.1"
                      @change="markDirty"
                    />
                  </el-form-item>
                </template>
              </template>

              <el-form-item label="允许转交">
                <el-switch
                  v-model="selectedNode.config.allowTransfer"
                  @change="markDirty"
                />
              </el-form-item>
              <el-form-item label="允许加签">
                <el-switch
                  v-model="selectedNode.config.allowAddSign"
                  @change="markDirty"
                />
              </el-form-item>

              <h5 class="section-title">
                服务等级协议
              </h5>
              <el-form-item label="超时时限 (小时，0=不限)">
                <el-input-number
                  v-model="selectedNode.config.timeout"
                  :min="0"
                  :max="720"
                  @change="markDirty"
                />
              </el-form-item>
              <el-form-item
                v-if="selectedNode.config.timeout > 0"
                label="预警时间 (小时)"
              >
                <el-input-number
                  v-model="selectedNode.config.warnAt"
                  :min="0"
                  :max="selectedNode.config.timeout"
                  @change="markDirty"
                />
              </el-form-item>
              <el-form-item
                v-if="selectedNode.config.timeout > 0"
                label="超时升级"
              >
                <el-select
                  v-model="selectedNode.config.escalateTo"
                  filterable
                  clearable
                  placeholder="超时后转交给"
                  @change="markDirty"
                >
                  <el-option
                    v-for="m in workspaceMembers"
                    :key="m.user.id"
                    :label="m.user.nickname || m.user.email"
                    :value="m.user.id"
                  />
                </el-select>
              </el-form-item>
            </template>

            <!-- ====== 抄送节点 ====== -->
            <template v-if="selectedNode.type === 'cc'">
              <h5 class="section-title">
                抄送配置
              </h5>
              <el-form-item label="抄送人">
                <el-select
                  v-model="ccSelected"
                  multiple
                  filterable
                  clearable
                  placeholder="选择抄送人（可多选）"
                  @change="updateCC"
                >
                  <el-option
                    v-for="m in workspaceMembers"
                    :key="m.user.id"
                    :label="m.user.nickname || m.user.email"
                    :value="m.user.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="通知方式">
                <el-checkbox-group
                  v-model="selectedNode.config.notifyChannels"
                  @change="markDirty"
                >
                  <el-checkbox
                    label="inApp"
                    value="inApp"
                  >
                    站内
                  </el-checkbox>
                  <el-checkbox
                    label="email"
                    value="email"
                  >
                    邮件
                  </el-checkbox>
                </el-checkbox-group>
              </el-form-item>
            </template>

            <!-- ====== 自动处理节点 ====== -->
            <template v-if="selectedNode.type === 'auto-task'">
              <h5 class="section-title">
                自动处理配置
              </h5>
              <el-form-item label="动作类型">
                <el-select
                  v-model="selectedNode.config.actionType"
                  @change="onAutoActionTypeChange"
                >
                  <el-option
                    label="发送通知"
                    value="notify"
                  />
                  <el-option
                    label="调用接口"
                    value="webhook"
                  />
                  <el-option
                    label="更新数据"
                    value="update"
                  />
                </el-select>
              </el-form-item>

              <!-- 发送通知 -->
              <template v-if="selectedNode.config.actionType === 'notify'">
                <el-form-item label="通知人">
                  <el-select
                    v-model="selectedNode.config.actionConfig.userIds"
                    multiple
                    filterable
                    clearable
                    placeholder="选择通知对象"
                    @change="markDirty"
                  >
                    <el-option
                      v-for="m in workspaceMembers"
                      :key="m.user.id"
                      :label="m.user.nickname || m.user.email"
                      :value="m.user.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="通知标题">
                  <el-input
                    v-model="selectedNode.config.actionConfig.title"
                    placeholder="自动通知标题"
                    @input="markDirty"
                  />
                </el-form-item>
                <el-form-item label="通知内容">
                  <el-input
                    v-model="selectedNode.config.actionConfig.content"
                    type="textarea"
                    :rows="2"
                    placeholder="自动通知内容"
                    @input="markDirty"
                  />
                </el-form-item>
              </template>

              <!-- 调用接口 -->
              <template v-if="selectedNode.config.actionType === 'webhook'">
                <el-form-item label="请求地址">
                  <el-input
                    v-model="selectedNode.config.actionConfig.url"
                    placeholder="https://..."
                    @input="markDirty"
                  />
                </el-form-item>
                <el-form-item label="请求方式">
                  <el-select
                    v-model="selectedNode.config.actionConfig.method"
                    @change="markDirty"
                  >
                    <el-option
                      label="POST"
                      value="POST"
                    />
                    <el-option
                      label="GET"
                      value="GET"
                    />
                    <el-option
                      label="PUT"
                      value="PUT"
                    />
                  </el-select>
                </el-form-item>
              </template>

              <!-- 更新数据 -->
              <template v-if="selectedNode.config.actionType === 'update'">
                <el-form-item label="字段名">
                  <el-input
                    v-model="selectedNode.config.actionConfig.field"
                    placeholder="如：status"
                    @input="markDirty"
                  />
                </el-form-item>
                <el-form-item label="更新为">
                  <el-input
                    v-model="selectedNode.config.actionConfig.value"
                    placeholder="如：approved"
                    @input="markDirty"
                  />
                </el-form-item>
              </template>
            </template>

            <!-- ====== 条件分支 ====== -->
            <template v-if="selectedNode.type === 'condition'">
              <h5 class="section-title">
                已有分支
              </h5>
              <div
                v-if="processVariables.length === 0"
                class="form-tip"
                style="color:#e6a23c;margin-bottom:12px"
              >
                请在开始节点中绑定表单并勾选流程变量
              </div>
              <div
                v-if="nodeOutEdges.length > 0"
                class="condition-branch-list"
              >
                <div
                  v-for="e in nodeOutEdges"
                  :key="e.id"
                  class="condition-branch"
                >
                  <div class="branch-header">
                    <span>{{ getNodeName(e.targetNodeId) }}</span>
                    <div class="branch-header-right">
                      <el-checkbox
                        :model-value="!!e._isDefault"
                        size="small"
                        @change="(v: boolean) => setDefaultBranch(e, v)"
                      >
                        默认分支
                      </el-checkbox>
                      <el-button
                        size="small"
                        text
                        type="danger"
                        @click="removeEdge(e.targetNodeId)"
                      >
                        <el-icon><Close /></el-icon>
                      </el-button>
                    </div>
                  </div>
                  <el-input
                    v-model="e.label"
                    placeholder="分支名（如：金额超5000）"
                    size="small"
                    class="branch-label"
                    @input="markDirty"
                  />
                  <!-- 默认分支不需要条件 -->
                  <template v-if="!e._isDefault">
                    <div class="condition-row">
                      <el-select
                        v-model="e._condField"
                        placeholder="字段"
                        size="small"
                        class="cond-field"
                        @change="(v: string) => buildCondition(e, v, e._condOp || '', e._condVal || '')"
                      >
                        <el-option
                          v-for="pv in processVariables"
                          :key="pv.key"
                          :label="pv.name"
                          :value="pv.key"
                        />
                      </el-select>
                      <el-select
                        v-model="e._condOp"
                        placeholder="运算符"
                        size="small"
                        class="cond-op"
                        @change="(v: string) => buildCondition(e, e._condField || '', v, e._condVal || '')"
                      >
                        <el-option
                          v-for="op in COND_OPERATORS"
                          :key="op.value"
                          :label="op.label"
                          :value="op.value"
                        />
                      </el-select>
                      <el-input
                        v-model="e._condVal"
                        placeholder="值"
                        size="small"
                        class="cond-val"
                        @input="(v: string) => buildCondition(e, e._condField || '', e._condOp || '', v)"
                      />
                    </div>
                    <div
                      v-if="e.condition"
                      class="condition-preview"
                    >
                      表达式：<code>{{ e.condition }}</code>
                    </div>
                    <div
                      v-else
                      class="form-tip"
                      style="margin:4px 0;color:#e6a23c"
                    >
                      请设置条件，或勾选"默认"作为兜底分支
                    </div>
                  </template>
                  <div
                    v-else
                    class="form-tip"
                    style="margin:4px 0"
                  >
                    不满足以上条件时走此分支
                  </div>
                </div>
              </div>
              <div
                v-else
                class="form-tip"
                style="color:#c0c4cc; margin-bottom: 12px"
              >
                暂无分支，请先连线
              </div>
              <el-divider />
              <el-form-item label="添加分支">
                <div class="edge-config">
                  <el-select
                    v-model="edgeTarget"
                    placeholder="目标节点"
                    size="small"
                    @change="setEdge"
                  >
                    <el-option
                      v-for="n in availableTargets"
                      :key="n.id"
                      :label="n.name"
                      :value="n.id"
                    />
                  </el-select>
                  <el-input
                    v-model="edgeLabel"
                    placeholder="分支名"
                    size="small"
                    style="width:80px"
                  />
                </div>
              </el-form-item>
            </template>

            <!-- ====== 并行 / 汇合 ====== -->
            <template v-if="selectedNode.type === 'parallel'">
              <h5 class="section-title">
                并行配置
              </h5>
              <p class="form-tip">
                所有出线将同时触发，每条线对应一个并行分支
              </p>
            </template>
            <template v-if="selectedNode.type === 'join'">
              <h5 class="section-title">
                汇合配置
              </h5>
              <el-form-item label="汇合方式">
                <el-select
                  v-model="selectedNode.config.type"
                  @change="markDirty"
                >
                  <el-option
                    label="等待全部"
                    value="all"
                  />
                  <el-option
                    label="任一到达"
                    value="any"
                  />
                </el-select>
              </el-form-item>
            </template>

            <!-- ====== 通用连线区（条件节点已在上方分支条件中管理） ====== -->
            <template v-if="selectedNode.type !== 'condition'">
              <el-divider />
              <el-form-item
                v-if="nodeOutEdges.length > 0"
                label="已有连线"
              >
                <div class="edge-list">
                  <div
                    v-for="e in nodeOutEdges"
                    :key="e.id"
                    class="edge-item"
                  >
                    <span>{{ getNodeName(e.targetNodeId) }}</span>
                    <el-button
                      size="small"
                      text
                      type="danger"
                      @click="removeEdge(e.targetNodeId)"
                    >
                      <el-icon><Close /></el-icon>
                    </el-button>
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="添加连线">
                <div class="edge-config">
                  <el-select
                    v-model="edgeTarget"
                    placeholder="选择下一节点"
                    size="small"
                    @change="setEdge"
                  >
                    <el-option
                      v-for="n in availableTargets"
                      :key="n.id"
                      :label="n.name"
                      :value="n.id"
                    />
                  </el-select>
                </div>
              </el-form-item>
            </template>

            <el-button
              v-if="selectedNode.type !== 'start' && selectedNode.type !== 'end'"
              type="danger"
              size="small"
              plain
              class="delete-btn"
              @click="removeNode(selectedNode.id)"
            >
              删除节点
            </el-button>
          </el-form>
        </template>

        <div
          v-if="panelMode === 'node' && !selectedNode"
          class="empty-hint"
        >
          <p>请选中节点后再查看属性列表</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, UserFilled, QuestionFilled, Connection, Rank,
  VideoPlay, VideoPause, Close, User, CopyDocument, Link,
  Clock, Download,
} from '@element-plus/icons-vue'
import http from '@/api/client'
import { useAppStore } from '@/stores/app'
import ProcessNodePalette from './ProcessNodePalette.vue'
import type { ProcessDefinition, ProcessNode, ProcessEdge, ProcessSettings, NodeType } from '@furmx/sdk'
import { coerceNodeConfig, FLOW_LAYOUT_GRID } from '@furmx/sdk'

interface WorkspaceMember { id: string; userId: string; user: { id: string; email: string; nickname?: string }; role: string }
interface WorkspaceRole { id: string; name: string; isSystem: boolean }
interface WorkspaceForm { id: string; name: string; schema: { fields: Array<{ key: string; name: string }> } }
interface FormField { key: string; name: string; type?: string; duplicate?: boolean }
/** 表单原始字段节点（来自未类型化的 JSON schema） */
interface RawFormField {
  key?: string
  name?: string
  type?: string
  children?: RawFormField[]
}
/** 连线在前端附加的 UI 状态字段（SDK 的 ProcessEdge 未声明） */
type DesignerEdge = ProcessEdge & {
  _isDefault?: boolean
  _condField?: string
  _condOp?: string
  _condVal?: string
}

const appStore = useAppStore()
const isDark = computed(() => appStore.isDark)

const route = useRoute()
const router = useRouter()
const wsId = computed(() => route.params.wsId as string)
const workflowId = computed(() => route.params.wfId as string)

// ---- 数据 ----
const definition = ref<ProcessDefinition | null>(null)
const nodes = ref<ProcessNode[]>([])
const edges = ref<DesignerEdge[]>([])
const selectedNodeId = ref<string | null>(null)
const dirty = ref(false)
const saving = ref(false)
const publishing = ref(false)
const workspaceMembers = ref<WorkspaceMember[]>([])
const workspaceRoles = ref<WorkspaceRole[]>([])
const workspaceForms = ref<WorkspaceForm[]>([])
const formFields = ref<FormField[]>([])
const loadedFormId = ref('')
const ccSelected = ref<string[]>([])
const edgeTarget = ref('')
const edgeLabel = ref('')
const panelMode = ref<'canvas' | 'node'>('canvas')
const gridType = ref<'none' | 'dot' | 'line'>('dot')
const dragOverCanvas = ref(false)

// ---- 列宽拖拽 ----
const MIN_LEFT = 150
const MAX_LEFT = 300
const MIN_RIGHT = 260
const MAX_RIGHT = 500
const leftWidth = ref(190)
const rightWidth = ref(310)
const resizing = ref<'left' | 'right' | null>(null)
let resizeStartX = 0
let resizeStartW = 0

function onResizeStart(side: 'left' | 'right', e: MouseEvent) {
  resizing.value = side
  resizeStartX = e.clientX
  resizeStartW = side === 'left' ? leftWidth.value : rightWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onResizeMove(e: MouseEvent) {
  if (!resizing.value) return
  const dx = e.clientX - resizeStartX
  if (resizing.value === 'left') {
    leftWidth.value = Math.max(MIN_LEFT, Math.min(MAX_LEFT, resizeStartW + dx))
  } else {
    rightWidth.value = Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, resizeStartW - dx))
  }
}
function onResizeUp() {
  if (resizing.value) {
    resizing.value = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
}

// ---- 画布 ----
const canvasRef = ref<HTMLElement>()
const canvasWidth = ref(1200)
const canvasHeight = ref(800)
const NODE_W = 180
const NODE_H = 58
const CIRCLE_SIZE = 60

// 拖拽状态
const dragging = ref(false)
const dragNodeId = ref<string | null>(null)
const dragOffset = reactive({ x: 0, y: 0 })
// 鼠标是否真的移动过 —— 用来区分「拖动」与「单击选中」：
// 只按不动的单击不应改写坐标，更不该吸附到网格（否则节点会莫名其妙微调）
const dragMoved = ref(false)
const dragStart = reactive({ x: 0, y: 0 })
/** 超过该像素位移才算拖动，滤掉手抖 */
const DRAG_THRESHOLD = 3
const connecting = ref(false)
const connectSourceId = ref<string | null>(null)
const tempLine = reactive({ show: false, d: '' })

// ---- 节点类型定义 ----
const approvalNodeTypes = [
  { type: 'direct-approval', label: '直属审批', icon: User, color: '#409eff' },
  { type: 'role-approval', label: '角色审批', icon: UserFilled, color: '#409eff' },
  { type: 'countersign', label: '会签', icon: Connection, color: '#5c6ac4' },
  { type: 'or-sign', label: '或签', icon: Link, color: '#3b82f6' },
]

const actionNodeTypes = [
  { type: 'cc', label: '抄送', icon: CopyDocument, color: '#909399' },
  { type: 'auto-task', label: '自动处理', icon: Clock, color: '#e6a23c' },
]

const gatewayNodeTypes = [
  { type: 'condition', label: '条件分支', icon: QuestionFilled, color: '#e6a23c' },
  { type: 'parallel', label: '并行网关', icon: Rank, color: '#8b5cf6' },
  { type: 'join', label: '汇聚网关', icon: Download, color: '#8b5cf6' },
]

function isApprovalType(t: string) { return ['direct-approval', 'role-approval', 'countersign', 'or-sign', 'approval'].includes(t) }
function isRoleApproval(t: string) { return t === 'role-approval' }
function isGateway(t: string) { return ['condition', 'parallel', 'join'].includes(t) }
function isCircle(t: string) { return t === 'start' || t === 'end' }
function isMultiAssign(node: ProcessNode | undefined) { return node && (node.type === 'countersign' || node.type === 'or-sign' || node.config?.type === 'multi') }

// ==================== 条件构建器 ====================
const COND_OPERATORS = [
  { value: '>', label: '>' },
  { value: '>=', label: '>=' },
  { value: '<', label: '<' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'startsWith', label: '开头是' },
  { value: 'endsWith', label: '结尾是' },
  { value: 'isEmpty', label: '为空' },
  { value: 'isNotEmpty', label: '非空' },
]

/** 流程的开始节点（有且仅有一个）。表单绑定（关联表单 + 流程变量）挂在它的 config 上，
 *  在「画布设置」里编辑（属流程级配置，不放在节点属性里） */
const startNode = computed(() => nodes.value.find((n: ProcessNode) => n.type === 'start'))

const processVariables = computed(() => {
  const varKeys: string[] = startNode.value?.config?.variables || []
  return varKeys.map((key: string) => {
    const ff = formFields.value.find((f: FormField) => f.key === key)
    return { key, name: ff?.name || key }
  })
})

function buildCondition(edge: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }, field: string, op: string, val: string) {
  edge._condField = field
  edge._condOp = op
  edge._condVal = val
  if (!field || !op) { edge.condition = ''; markDirty(); return }

  const needVal = !['isEmpty', 'isNotEmpty'].includes(op)
  if (needVal && !val) { edge.condition = ''; markDirty(); return }

  const ref = field
  let expr = ''
  switch (op) {
    case 'contains': expr = buildFn('includes', ref, val); break
    case 'notContains': expr = `!${buildFn('includes', ref, val)}`; break
    case 'startsWith': expr = buildFn('startsWith', ref, val); break
    case 'endsWith': expr = buildFn('endsWith', ref, val); break
    case 'isEmpty': expr = `isEmpty(${ref})`; break
    case 'isNotEmpty': expr = `!isEmpty(${ref})`; break
    default: expr = isNaN(Number(val)) ? `${ref} ${op} '${val}'` : `${ref} ${op} ${val}`
  }
  edge.condition = expr
  markDirty()
}

function buildFn(fn: string, ref: string, val: string) {
  return isNaN(Number(val)) ? `${fn}(${ref}, '${val}')` : `${fn}(${ref}, ${val})`
}

function setDefaultBranch(edge: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }, isDefault: boolean) {
  if (isDefault) {
    // 取消同节点的其他默认分支
    nodeOutEdges.value.forEach((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => { e._isDefault = false })
    edge._isDefault = true
    edge.condition = ''
    edge._condField = ''; edge._condOp = ''; edge._condVal = ''
  } else {
    edge._isDefault = false
  }
  markDirty()
}

/** 从已有表达式解析回构建器字段 */
function parseConditionForEdge(edge: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) {
  const raw = edge.condition || ''
  if (!raw) return
  // 先剥离可能存在的旧格式 ${xxx} 包装
  const expr = raw.replace(/\$\{(\w+)\}/g, '$1').replace(/^!?\w+\.\w+/, m => {
    if (m.startsWith('!')) return '!' + m.slice(1).split('.')[1]
    return m.split('.')[1]
  })

  // 函数格式: fn(field, 'val') 或 !fn(field)
  const fnMatch = expr.match(/^(!?)(\w+)\((\w+)(?:,\s*(.+?))?\)$/)
  if (fnMatch) {
    const neg = fnMatch[1] === '!'
    const fnName = fnMatch[2]
    edge._condField = fnMatch[3]
    const val = (fnMatch[4] || '').replace(/^'|'$/g, '')
    if (fnName === 'isEmpty' && !neg) { edge._condOp = 'isEmpty'; edge._condVal = ''; return }
    if (fnName === 'isEmpty' && neg) { edge._condOp = 'isNotEmpty'; edge._condVal = ''; return }
    if (fnName === 'includes' && !neg) { edge._condOp = 'contains'; edge._condVal = val; return }
    if (fnName === 'includes' && neg) { edge._condOp = 'notContains'; edge._condVal = val; return }
    if (fnName === 'startsWith' && !neg) { edge._condOp = 'startsWith'; edge._condVal = val; return }
    if (fnName === 'endsWith' && !neg) { edge._condOp = 'endsWith'; edge._condVal = val; return }
    return
  }

  // 比较格式: field > 5000 或 field == 'text'
  const cmpMatch = expr.match(/^(\w+)\s*([><=!]+)\s*(.+)$/)
  if (cmpMatch) {
    edge._condField = cmpMatch[1]
    const opMap: Record<string, string> = { '>': '>', '>=': '>=', '<': '<', '<=': '<=', '==': '==', '!=': '!=' }
    edge._condOp = opMap[cmpMatch[2]] || cmpMatch[2]
    edge._condVal = cmpMatch[3].replace(/^'|'$/g, '')
  }
}

function nodeClasses(node: ProcessNode) {
  return [
    'canvas-node',
    'node-' + node.type,
    { selected: selectedNodeId.value === node.id },
  ]
}

function nodeStyle(node: ProcessNode) {
  if (isCircle(node.type)) {
    return {
      left: node.position.x + 'px',
      top: node.position.y + 'px',
      width: CIRCLE_SIZE + 'px',
      height: CIRCLE_SIZE + 'px',
      borderRadius: '50%',
    }
  }
  if (isGateway(node.type)) {
    return {
      left: node.position.x + 'px',
      top: node.position.y + 'px',
      width: '150px',
      height: '80px',
    }
  }
  return {
    left: node.position.x + 'px',
    top: node.position.y + 'px',
    width: NODE_W + 'px',
    height: NODE_H + 'px',
  }
}

function nodeIconSize(type: string) {
  return isCircle(type) ? 22 : isGateway(type) ? 18 : 16
}

function nodeTypeIcon(type: string) {
  const map: Record<string, any> = {
    start: VideoPlay, end: VideoPause,
    'direct-approval': User, 'role-approval': UserFilled,
    countersign: Connection, 'or-sign': Link,
    approval: UserFilled, cc: CopyDocument, 'auto-task': Clock,
    condition: QuestionFilled, parallel: Rank, join: Download,
  }
  return map[type] || QuestionFilled
}

function nodeTypeLabel(type: string) {
  const map: Record<string, string> = {
    start: '开始', end: '结束',
    'direct-approval': '直属审批', 'role-approval': '角色审批',
    countersign: '会签', 'or-sign': '或签', approval: '审批',
    cc: '抄送', 'auto-task': '自动处理',
    condition: '条件分支', parallel: '并行网关', join: '汇聚网关',
  }
  return map[type] || type
}

// ---- 连线路径计算 ----
const edgePaths = computed(() => {
  return edges.value.map((e: DesignerEdge) => {
    const src = nodes.value.find((n: ProcessNode) => n.id === e.sourceNodeId)
    const tgt = nodes.value.find((n: ProcessNode) => n.id === e.targetNodeId)
    if (!src || !tgt) return { id: e.id, sourceId: e.sourceNodeId, targetId: e.targetNodeId, d: '', label: e.label || '', labelX: 0, labelY: 0, labelW: 0 }

    // 根据节点形状计算连接点
    const srcW = isCircle(src.type) ? CIRCLE_SIZE : isGateway(src.type) ? 150 : NODE_W
    const srcH = isCircle(src.type) ? CIRCLE_SIZE : isGateway(src.type) ? 80 : NODE_H
    const tgtW = isCircle(tgt.type) ? CIRCLE_SIZE : isGateway(tgt.type) ? 150 : NODE_W

    const x1 = src.position.x + srcW / 2
    const y1 = src.position.y + srcH
    const x2 = tgt.position.x + tgtW / 2
    const y2 = tgt.position.y
    const midY = (y1 + y2) / 2
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`

    // 标签位置：贝塞尔曲线中点
    const labelX = (x1 + x2) / 2
    const labelY = midY - 6

    const labelTxt: string = e.label || ''
    const labelW = labelTxt.length * 12  // 估算中文宽度

    return { id: e.id, sourceId: e.sourceNodeId, targetId: e.targetNodeId, d, label: labelTxt, labelX, labelY, labelW }
  })
})

// ---- 选中节点 ----
const selectedNode = computed(() => nodes.value.find((n) => n.id === selectedNodeId.value) || null)
const nodeOutEdges = computed(() => edges.value.filter((e: DesignerEdge) => e.sourceNodeId === selectedNodeId.value))
const assigneeSelectValue = computed(() => {
  if (!selectedNode.value) return []
  const arr = selectedNode.value.config.assignees || []
  return selectedNode.value.config.type === 'multi' ? arr : (arr[0] || '')
})

const availableTargets = computed(() => nodes.value.filter((n) => n.id !== selectedNodeId.value))

function isEdgeSelected(ep: { sourceId?: string; targetId?: string }) {
  const sid = selectedNodeId.value
  return sid && (ep.sourceId === sid || ep.targetId === sid)
}

function getNodeName(nodeId: string) {
  const n = nodes.value.find((n) => n.id === nodeId)
  return n ? n.name : nodeId
}

// ---- 加载 / 选中 ----
onMounted(() => { loadDefinition(); fetchMembers(); fetchRoles(); fetchForms() })

async function fetchMembers() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/members`) as any
    const data = res.data || res
    workspaceMembers.value = Array.isArray(data) ? data : (data.list || [])
  } catch { /* ignore */ }
}

async function fetchRoles() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/roles`) as any
    const data = res.data || res
    workspaceRoles.value = Array.isArray(data) ? data : (data.list || [])
  } catch { /* ignore */ }
}

async function fetchForms() {
  try {
    const res = await http.get(`/workspaces/${wsId.value}/forms`, { params: { page: 1, pageSize: 200 } }) as any
    const data = res.data || res
    workspaceForms.value = Array.isArray(data) ? data : (data.list || [])
  } catch { /* ignore */ }
}

/** 仅加载表单字段列表（不清除已勾选的变量），用于回显 */
async function loadFormFields(formId: string) {
  formFields.value = []
  loadedFormId.value = formId
  try {
    const res = await http.get(`/forms/${formId}`) as any
    const data = res.data || res
    const schema = data.schema
    if (schema && schema.fields) {
      formFields.value = extractFormFields(schema.fields)
    }
  } catch { /* ignore */ }
}

async function onFormBind(formId: string) {
  const node = startNode.value
  if (!node) return
  node.config.variables = []
  formFields.value = []
  if (!formId) { markDirty(); return }
  const form = workspaceForms.value.find((f) => f.id === formId)
  node.config.formName = form?.name || ''
  try {
    const res = await http.get(`/forms/${formId}`) as any
    const data = res.data || res
    const schema = data.schema
    if (schema && schema.fields) {
      formFields.value = extractFormFields(schema.fields)
      // 检查是否有同名字段
      const dup = formFields.value.find((f: FormField) => f.duplicate)
      if (dup) {
        ElMessage.warning('表单中存在同名字段，不可绑定流程')
        node.config.formId = ''
        node.config.formName = ''
        node.config.variables = []
        formFields.value = []
      }
    }
  } catch { /* ignore */ }
  markDirty()
}

/** 初始化开始节点的表单绑定字段，并按需加载所绑表单的字段列表（供画布设置与流程变量使用） */
function syncStartFormFields() {
  const node = startNode.value
  if (!node) return
  if (!node.config.formId) node.config.formId = ''
  if (!node.config.formName) node.config.formName = ''
  if (!node.config.variables) node.config.variables = []
  if (node.config.formId && node.config.formId !== loadedFormId.value) {
    loadFormFields(node.config.formId)
  } else if (!node.config.formId) {
    formFields.value = []
    loadedFormId.value = ''
  }
}

/** 递归提取表单字段（排除布局容器、提示文字等无值字段），标注重名 */
function extractFormFields(fields: RawFormField[]): FormField[] {
  const result: FormField[] = []
  const skipTypes = ['card', 'collapse', 'tabs', 'divider', 'tip-text']
  for (const f of fields) {
    if (f.type && skipTypes.includes(f.type)) {
      if (f.children) result.push(...extractFormFields(f.children))
      continue
    }
    if (f.key) result.push({ key: f.key, name: f.name || f.key, type: f.type })
  }
  // 检测重名字段
  const nameCount = new Map<string, number>()
  result.forEach(f => nameCount.set(f.name, (nameCount.get(f.name) || 0) + 1))
  result.forEach(f => { f.duplicate = nameCount.get(f.name)! > 1 })
  return result
}

/**
 * 归一节点：历史数据/agent 写入可能把 config（或 config 内部的嵌套字段，如
 * branches）存成 JSON 字符串，设计器是按对象读写 config 的（`node.config.xxx = …`），
 * 对字符串赋值会抛 TypeError → 整个「设计」页加载失败。加载时递归转成对象。
 */
function normalizeNode(n: ProcessNode): ProcessNode {
  n.config = coerceNodeConfig(n.config) as ProcessNode['config']
  return n
}

async function loadDefinition() {
  try {
    const res = await http.get(`/workflows/${workflowId.value}`) as any
    const data = res.data || res
    const def: ProcessDefinition = data
    definition.value = def
    // settings 可能缺失，接口返回的是未类型化 JSON
    if (!def.settings) def.settings = {} as ProcessSettings
    nodes.value = (def.nodes || []).map(normalizeNode)
    edges.value = [...(def.edges || [])]
    updateCanvasSize()
    // 表单绑定在画布设置里（默认面板），进入即需回显字段 → 这里就初始化
    syncStartFormFields()
  } catch {
    ElMessage.error('加载失败')
    goBack()
  }
}

function updateCanvasSize() {
  let maxX = 800, maxY = 600
  nodes.value.forEach((n: ProcessNode) => {
    const w = isCircle(n.type) ? CIRCLE_SIZE : isGateway(n.type) ? 150 : NODE_W
    const h = isCircle(n.type) ? CIRCLE_SIZE : isGateway(n.type) ? 80 : NODE_H
    if (n.position.x + w + 100 > maxX) maxX = n.position.x + w + 100
    if (n.position.y + h + 100 > maxY) maxY = n.position.y + h + 100
  })
  canvasWidth.value = Math.max(1000, maxX)
  canvasHeight.value = Math.max(600, maxY)
}

function selectNode(node: ProcessNode) {
  selectedNodeId.value = node.id
  panelMode.value = 'node'
  edgeLabel.value = ''
  // 单出口节点回显已有连线目标
  const outEdges = edges.value.filter((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId === node.id)
  edgeTarget.value = outEdges.length === 1 ? outEdges[0].targetNodeId : ''
  if (isApprovalType(node.type)) {
    if (!node.config.assignees) node.config.assignees = []
    if (!node.config.strategy) {
      node.config.strategy = { type: node.type === 'countersign' ? 'all' : 'any' }
    }
  }
  if (isRoleApproval(node.type)) {
    if (!node.config.approvalMode) node.config.approvalMode = 'assignee'
    if (!node.config.roleList) node.config.roleList = []
    // 选中单个审批人后自动反查其工作空间角色
    if (node.config.assignees?.length === 1) {
      const member = workspaceMembers.value.find((m: WorkspaceMember) => m.user.id === node.config.assignees[0])
      if (member) node.config.role = member.role
    }
  }
  if (node.type === 'condition') {
    // 初始化条件构建器状态，并尝试从已有表达式回显
    const outEdges2 = edges.value.filter((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId === node.id)
    outEdges2.forEach((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => {
      if (e._condField === undefined) e._condField = ''
      if (e._condOp === undefined) e._condOp = ''
      if (e._condVal === undefined) e._condVal = ''
      if (e._isDefault === undefined) e._isDefault = false
      if (e.condition && !e._condField) parseConditionForEdge(e)
    })
  }
  if (node.type === 'cc') {
    ccSelected.value = node.config.ccList || []
    if (!node.config.notifyChannels) node.config.notifyChannels = ['inApp']
  }
  if (node.type === 'auto-task') {
    if (!node.config.actionType) node.config.actionType = 'notify'
    if (!node.config.actionConfig || typeof node.config.actionConfig === 'string' || Object.keys(node.config.actionConfig).length === 0) {
      if (node.config.actionType === 'notify') node.config.actionConfig = { userIds: [], title: '', content: '' }
      else if (node.config.actionType === 'webhook') node.config.actionConfig = { url: '', method: 'POST' }
      else if (node.config.actionType === 'update') node.config.actionConfig = { field: '', value: '' }
    }
  }
}

function switchToNode() { panelMode.value = 'node' }

function onNodeNameInput(val: string | unknown) {
  if (!selectedNode.value) return
  selectedNode.value.name = String(val ?? '')
  markDirty()
}

// ---- 添加/删除 ----
function addNode(type: string, posX?: number, posY?: number) {
  const id = 'node_' + Date.now()
  const baseConfig: any = { description: '' }

  if (isApprovalType(type)) {
    if (type === 'direct-approval') {
      baseConfig.type = 'single'
      baseConfig.assignees = []
      baseConfig.timeout = 0
      baseConfig.warnAt = 0
      baseConfig.escalateTo = ''
      baseConfig.allowTransfer = false
      baseConfig.allowAddSign = false
    } else if (type === 'role-approval') {
      baseConfig.type = 'single'
      baseConfig.assignees = []
      baseConfig.approvalMode = 'assignee'
      baseConfig.role = ''
      baseConfig.roleList = []
      baseConfig.strategy = { type: 'any' }
      baseConfig.timeout = 0
      baseConfig.warnAt = 0
      baseConfig.escalateTo = ''
      baseConfig.allowTransfer = false
      baseConfig.allowAddSign = false
    } else {
      // countersign / or-sign
      baseConfig.type = 'multi'
      baseConfig.assignees = []
      baseConfig.strategy = { type: type === 'countersign' ? 'all' : 'any' }
      baseConfig.timeout = type === 'countersign' ? 48 : 0
      baseConfig.warnAt = 4
      baseConfig.escalateTo = ''
      baseConfig.allowTransfer = false
      baseConfig.allowAddSign = type === 'countersign'
    }
  } else if (type === 'cc') {
    baseConfig.ccList = []
    baseConfig.notifyChannels = ['inApp']
  } else if (type === 'auto-task') {
    baseConfig.actionType = 'notify'
    baseConfig.actionConfig = { userIds: [], title: '', content: '' }
  } else if (type === 'join') {
    baseConfig.type = 'all'
  }

  const position = (posX !== undefined && posY !== undefined)
    ? { x: posX, y: posY }
    : (() => {
        const count = nodes.value.filter((n) => n.type !== 'start' && n.type !== 'end').length
        return { x: 100 + (count % 4) * 220, y: 150 + Math.floor(count / 4) * 130 }
      })()

  nodes.value.push({
    id, type: type as NodeType,
    name: nodeTypeLabel(type),
    position,
    config: baseConfig,
  })
  updateCanvasSize()
  markDirty()
}

function removeNode(nodeId: string) {
  nodes.value = nodes.value.filter((n) => n.id !== nodeId)
  edges.value = edges.value.filter((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId)
  if (selectedNodeId.value === nodeId) { selectedNodeId.value = null; edgeTarget.value = '' }
  updateCanvasSize()
  markDirty()
}

function clearAll() {
  ElMessageBox.confirm('确认清空所有节点（保留开始和结束）？', '提示', { type: 'warning' })
    .then(() => {
      nodes.value = nodes.value.filter((n) => n.type === 'start' || n.type === 'end')
      edges.value = []
      selectedNodeId.value = null
      updateCanvasSize()
      markDirty()
    })
    .catch(() => {})
}

// ---- 从面板拖入画布 ----
function onCanvasDragOver(e: DragEvent) {
  if (e.dataTransfer!.types.includes('application/furmx-node-type')) {
    e.dataTransfer!.dropEffect = 'copy'
    dragOverCanvas.value = true
  }
}

function onCanvasDragLeave(e: DragEvent) {
  if (!canvasRef.value!.contains(e.relatedTarget as Node)) {
    dragOverCanvas.value = false
  }
}

function onCanvasDrop(e: DragEvent) {
  dragOverCanvas.value = false
  const nodeType = e.dataTransfer!.getData('application/furmx-node-type')
  if (!nodeType) return

  const rect = canvasRef.value!.getBoundingClientRect()
  const x = e.clientX - rect.left + canvasRef.value!.scrollLeft
  const y = e.clientY - rect.top + canvasRef.value!.scrollTop

  const nodeW = isCircle(nodeType) ? CIRCLE_SIZE : isGateway(nodeType) ? 150 : NODE_W
  const nodeH = isCircle(nodeType) ? CIRCLE_SIZE : isGateway(nodeType) ? 80 : NODE_H

  const posX = snapToGrid(x - nodeW / 2)
  const posY = snapToGrid(y - nodeH / 2)

  addNode(nodeType, Math.max(0, posX), Math.max(0, posY))
}

const GRID_SIZE = FLOW_LAYOUT_GRID

function snapToGrid(val: number) {
  return Math.round(val / GRID_SIZE) * GRID_SIZE
}

function onNodeMouseDown(e: MouseEvent, node: ProcessNode) {
  if ((e.target as HTMLElement).classList.contains('port')) return
  dragging.value = true
  dragNodeId.value = node.id
  dragMoved.value = false
  dragStart.x = e.clientX
  dragStart.y = e.clientY
  const rect = canvasRef.value!.getBoundingClientRect()
  dragOffset.x = e.clientX - rect.left - node.position.x
  dragOffset.y = e.clientY - rect.top - node.position.y
  e.preventDefault()
}

function onCanvasMouseMove(e: MouseEvent) {
  if (connecting.value) {
    const rect = canvasRef.value!.getBoundingClientRect()
    const x = e.clientX - rect.left + canvasRef.value!.scrollLeft
    const y = e.clientY - rect.top + canvasRef.value!.scrollTop
    const srcNode = nodes.value.find((n) => n.id === connectSourceId.value)
    if (srcNode) {
      const srcW = isCircle(srcNode.type) ? CIRCLE_SIZE : isGateway(srcNode.type) ? 150 : NODE_W
      const srcH = isCircle(srcNode.type) ? CIRCLE_SIZE : isGateway(srcNode.type) ? 80 : NODE_H
      const sx = srcNode.position.x + srcW / 2
      const sy = srcNode.position.y + srcH / 2
      tempLine.d = `M ${sx} ${sy} L ${x} ${y}`
    }
    return
  }
  if (dragging.value && dragNodeId.value) {
    // 未超过阈值前不动：单击时的手抖不该改写坐标
    if (!dragMoved.value &&
        Math.abs(e.clientX - dragStart.x) <= DRAG_THRESHOLD &&
        Math.abs(e.clientY - dragStart.y) <= DRAG_THRESHOLD) {
      return
    }
    dragMoved.value = true
    const node = nodes.value.find((n) => n.id === dragNodeId.value)
    if (!node) return
    const rect = canvasRef.value!.getBoundingClientRect()
    node.position.x = Math.max(0, e.clientX - rect.left - dragOffset.x)
    node.position.y = Math.max(0, e.clientY - rect.top - dragOffset.y)
    markDirty()
  }
}

function onCanvasMouseUp() {
  if (dragging.value && dragNodeId.value) {
    // 只有真正拖动过才吸附落位；单击选中保持原坐标不动
    if (dragMoved.value) {
      const node = nodes.value.find((n) => n.id === dragNodeId.value)
      if (node) {
        node.position.x = snapToGrid(node.position.x)
        node.position.y = snapToGrid(node.position.y)
      }
    }
    dragging.value = false; dragNodeId.value = null; dragMoved.value = false; updateCanvasSize()
  }
}

function onCanvasMouseDown(e: MouseEvent) {
  if (connecting.value) { cancelConnect(); return }
  if (e.target === canvasRef.value || (e.target as HTMLElement).classList.contains('nodes-layer')) {
    selectedNodeId.value = null; edgeTarget.value = ''
  }
}

function onCanvasRightClick(e: MouseEvent) { e.preventDefault(); if (connecting.value) cancelConnect() }

// ---- 连线 ----
function onPortClick(node: ProcessNode) {
  if (!connecting.value) {
    connecting.value = true; connectSourceId.value = node.id; tempLine.show = true
    const w = isCircle(node.type) ? CIRCLE_SIZE : isGateway(node.type) ? 150 : NODE_W
    const h = isCircle(node.type) ? CIRCLE_SIZE : isGateway(node.type) ? 80 : NODE_H
    const sx = node.position.x + w / 2; const sy = node.position.y + h / 2
    tempLine.d = `M ${sx} ${sy} L ${sx} ${sy}`
  } else if (connectSourceId.value === node.id) {
    cancelConnect()
  } else {
    if (connectSourceId.value) addEdge(connectSourceId.value, node.id, edgeLabel.value || undefined)
    if (selectedNodeId.value === connectSourceId.value) edgeTarget.value = node.id
    connecting.value = false; connectSourceId.value = null; tempLine.show = false
    edgeLabel.value = ''
    updateCanvasSize(); markDirty()
  }
}

function addEdge(sourceId: string, targetId: string, label?: string, condition?: string) {
  const srcNode = nodes.value.find((n) => n.id === sourceId)
  const isMulti = srcNode && (srcNode.type === 'parallel' || srcNode.type === 'condition')
  if (isMulti) {
    const dup = edges.value.find((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId === sourceId && e.targetNodeId === targetId)
    if (dup) return
    edges.value.push({ id: 'e_' + Date.now(), sourceNodeId: sourceId, targetNodeId: targetId, label: label || '', condition: condition || '' })
  } else {
    const existingIdx = edges.value.findIndex((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId === sourceId)
    if (existingIdx >= 0) {
      edges.value[existingIdx].targetNodeId = targetId
      if (label !== undefined) edges.value[existingIdx].label = label
      if (condition !== undefined) edges.value[existingIdx].condition = condition
    } else {
      edges.value.push({ id: 'e_' + Date.now(), sourceNodeId: sourceId, targetNodeId: targetId, label: label || '', condition: condition || '' })
    }
  }
}

function cancelConnect() {
  connecting.value = false; connectSourceId.value = null; tempLine.show = false
}

function setEdge(targetId: string) {
  if (!selectedNodeId.value || !targetId) return
  addEdge(selectedNodeId.value, targetId, edgeLabel.value || undefined)
  edgeLabel.value = ''
  markDirty()
}

function removeEdge(targetId?: string) {
  if (!selectedNodeId.value) return
  if (targetId) {
    edges.value = edges.value.filter((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => !(e.sourceNodeId === selectedNodeId.value && e.targetNodeId === targetId))
  } else {
    edges.value = edges.value.filter((e: ProcessEdge & { _isDefault?: boolean; _condField?: string; _condOp?: string; _condVal?: string }) => e.sourceNodeId !== selectedNodeId.value)
  }
  edgeTarget.value = ''
  markDirty()
}

// ---- 审批人 / 抄送 ----
function onApprovalModeChange() {
  if (!selectedNode.value) return
  if (selectedNode.value.config.approvalMode === 'assignee') {
    selectedNode.value.config.roleList = []
  } else {
    selectedNode.value.config.assignees = []
  }
  markDirty()
}

function onAutoActionTypeChange() {
  if (!selectedNode.value) return
  // 切换动作类型时初始化对应配置
  const config = selectedNode.value.config
  if (config.actionType === 'notify') {
    config.actionConfig = { userIds: [], title: '', content: '' }
  } else if (config.actionType === 'webhook') {
    config.actionConfig = { url: '', method: 'POST' }
  } else if (config.actionType === 'update') {
    config.actionConfig = { field: '', value: '' }
  }
  markDirty()
}

function onAssigneesChange(val: string | string[]) {
  if (!selectedNode.value) return
  const arr = Array.isArray(val) ? val : [val]
  selectedNode.value.config.assignees = arr.filter(Boolean)
  // 角色审批：选中单个审批人后自动反查其工作空间角色
  if (isRoleApproval(selectedNode.value.type) && arr.length === 1) {
    const member = workspaceMembers.value.find((m: WorkspaceMember) => m.user.id === arr[0])
    if (member) {
      selectedNode.value.config.role = member.role
    }
  }
  markDirty()
}

function updateCC() {
  if (selectedNode.value?.type === 'cc') {
    selectedNode.value.config.ccList = [...ccSelected.value]
    markDirty()
  }
}

// ---- 保存/发布 ----
function markDirty() { dirty.value = true }

async function saveDefinition() {
  if (!dirty.value) return
  const def = definition.value
  if (!def) return
  saving.value = true
  try {
    await http.patch(`/workflows/${workflowId.value}`, {
      name: def.name,
      description: def.description,
      nodes: nodes.value,
      edges: edges.value,
      settings: def.settings,
    })
    dirty.value = false
    ElMessage.success('已保存')
  } catch (e: unknown) { if (handled(e)) return; ElMessage.error(errMessage(e, '保存失败')) } finally { saving.value = false }
}

async function publishDef() {
  const def = definition.value
  if (!def) return
  saving.value = true
  try {
    if (dirty.value) await saveDefinition()
    await http.post(`/workflows/${workflowId.value}/publish`)
    def.status = 'published'
    ElMessage.success('已发布')
  } catch (e: unknown) { if (handled(e)) return; ElMessage.error(errMessage(e, '发布失败')) } finally { saving.value = false }
}

/** api/client 已对 401/403 做过全局处理，这些错误不用再弹一次 */
function handled(e: unknown) {
  return e instanceof Error && (e as { __handled?: boolean }).__handled === true
}

/** 冲突（409，如同一张表单已被其他已发布流程绑定）的原因在响应体里，别被兜底文案盖掉 */
function errMessage(e: unknown, fallback: string) {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
  return msg || fallback
}

function goBack() { router.push(`/workspace/${wsId.value}/workflows`) }
</script>

<style scoped>
.process-designer { display: flex; flex-direction: column; height: 100%; }

.designer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px;
  background: var(--app-bg-card, #fff);
  border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px;
  flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
.header-center { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.header-right { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: 1; min-width: 0; }
.header-title { margin: 0; font-size: 16px; font-weight: 600; white-space: nowrap; }

.designer-body { display: flex; flex: 1; overflow: hidden; margin-top: 12px; gap: 10px; }

/* ---- 左侧面板 ---- */
.panel-left {
  flex-shrink: 0; overflow-y: auto; overflow-x: hidden;
  background: var(--app-bg-card, #fff); border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px; padding: 10px;
}
.panel-left::-webkit-scrollbar { width: 6px; }
.panel-left::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.panel-left:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }
.panel-left h4 { margin: 10px 0 6px; font-size: 12px; color: #909399; text-transform: uppercase; }
.panel-left h4:first-child { margin-top: 0; }
.palette-list { display: flex; flex-direction: column; gap: 4px; }
.palette-item {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border: 1px solid #e4e7ed; border-radius: 4px; cursor: pointer;
  font-size: 12px; transition: all 0.15s;
}
.palette-item:hover { border-color: #409eff; color: #409eff; background: #ecf5ff; }
.palette-item:active { cursor: grabbing; }
.palette-item[draggable="true"] { cursor: grab; }

/* ---- 画布 ---- */
.canvas-area {
  flex: 1; background: var(--app-bg-page, #f5f6f8); border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px; position: relative; overflow: auto; cursor: default;
}
.canvas-area::-webkit-scrollbar { width: 6px; height: 6px; }
.canvas-area::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.canvas-area:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }
.canvas-area::-webkit-scrollbar-corner { background: transparent; }
.canvas-area.drag-over { box-shadow: inset 0 0 0 2px #409eff; }
.edges-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 1; }
.edges-layer path {
  transition: d 0.1s, stroke 0.2s, stroke-width 0.2s;
}
.edges-layer path.edge-selected {
  stroke: #409eff !important;
  stroke-width: 2.5;
}
.nodes-layer { position: relative; z-index: 2; }

/* ---- 节点通用 ---- */
.canvas-node {
  position: absolute; background: #fff; border: 2px solid #dcdfe6;
  cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  box-sizing: border-box;
}
.canvas-node:hover { border-color: #409eff; }
.canvas-node.selected {
  outline: 2px solid #409eff;
  outline-offset: 3px;
  z-index: 10;
}

.node-content { display: flex; align-items: center; gap: 6px; padding: 8px; }
.node-name { font-size: 13px; font-weight: 500; white-space: nowrap; }

.node-delete {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px; line-height: 18px; text-align: center;
  font-size: 14px; color: #fff; background: #f56c6c;
  border-radius: 50%; cursor: pointer; z-index: 10;
  opacity: 0; transition: opacity 0.15s;
}
.canvas-node:hover .node-delete { opacity: 1; }
.node-delete:hover { background: #e04040; }

/* 圆角矩形（审批/抄送/自动处理） */
.canvas-node:not(.node-start):not(.node-end):not(.node-condition):not(.node-parallel):not(.node-join) {
  border-radius: 8px;
  min-height: 56px;
}

/* 开始/结束圆形 */
.node-start { border-color: #67c23a; background: #f0f9eb; }
.node-end { border-color: #f56c6c; background: #fef0f0; }
.node-start .node-content { justify-content: center; }
.node-end .node-content { justify-content: center; }

/* 网关菱形 */
.node-condition, .node-parallel, .node-join {
  border-radius: 4px;
  border-width: 2px;
}
.node-condition::before, .node-parallel::before, .node-join::before {
  content: ''; position: absolute; top: 2px; left: 2px; right: 2px; bottom: 2px;
  border: 1px solid currentColor; border-radius: 2px; opacity: 0.3;
}
.node-condition { border-color: #e6a23c; background: #fef9f0; }
.node-parallel { border-color: #8b5cf6; background: #f5f3ff; }
.node-join { border-color: #8b5cf6; background: #f5f3ff; }

/* 审批节点颜色变体 */
.node-direct-approval, .node-role-approval, .node-approval { border-color: #409eff; }
.node-direct-approval .node-content, .node-role-approval .node-content, .node-approval .node-content,
.node-countersign .node-content, .node-or-sign .node-content { padding: 8px 10px; }
.node-countersign { border-color: #5c6ac4; }
.node-or-sign { border-color: #3b82f6; }

/* 抄送 */
.node-cc { border-color: #909399; border-style: dashed; }
.node-auto-task { border-color: #e6a23c; }

/* ---- 端口 ---- */
.port {
  position: absolute; left: 50%; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; border: 2px solid #c0c4cc; transform: translateX(-50%);
  z-index: 6; opacity: 0; transition: opacity 0.15s, border-color 0.15s; cursor: crosshair;
}
.canvas-node:hover .port { opacity: 1; }
.port:hover { border-color: #409eff; background: #ecf5ff; }
.port.active { opacity: 1; border-color: #409eff; background: #409eff; }
.port-in { top: -6px; }
.port-out { bottom: -6px; }

/* ---- 右侧面板 ---- */
.panel-right {
  flex-shrink: 0; overflow-y: auto; overflow-x: hidden;
  background: var(--app-bg-card, #fff); border: 1px solid var(--app-border-color, #e4e7ed);
  border-radius: 8px; padding: 16px;
}
.panel-right::-webkit-scrollbar { width: 6px; }
.panel-right::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.panel-right:hover::-webkit-scrollbar-thumb { background: #c0c4cc; }

/* ---- 拖拽分隔线 ---- */
.resize-divider {
  width: 6px; flex-shrink: 0; cursor: col-resize; background: transparent;
  transition: background 0.15s; position: relative; z-index: 5;
}
.resize-divider:hover, .resize-divider.active { background: rgba(64,158,255,0.15); }
.divider-grip {
  width: 3px; height: 32px; border-radius: 2px; background: #c0c4cc;
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  transition: background 0.15s;
}
.resize-divider:hover .divider-grip, .resize-divider.active .divider-grip { background: #409eff; }
.panel-nav { display: flex; margin-bottom: 16px; border-bottom: 2px solid #e4e7ed; }
.nav-item {
  padding: 8px 14px; font-size: 13px; color: #909399; cursor: pointer;
  border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; user-select: none;
}
.nav-item:hover { color: #409eff; }
.nav-item.active { color: #409eff; border-bottom-color: #409eff; font-weight: 600; }
.panel-title { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #303133; }

.section-title {
  font-size: 13px; font-weight: 600; color: #606266;
  margin: 0 0 12px; padding-bottom: 6px;
  border-bottom: 1px solid #ebeef5;
}
.prop-form :deep(.el-form-item) { margin-bottom: 14px; }
.prop-form :deep(.el-slider__button) { opacity: 0; transition: opacity 0.2s; }
.prop-form :deep(.el-form-item):hover .el-slider__button { opacity: 1; }
.form-tip { font-size: 12px; color: #909399; margin: 0; padding: 4px 0; }

.canvas-stats { display: flex; flex-direction: column; gap: 8px; }
.stat-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #f5f7fa; border-radius: 4px; font-size: 13px; color: #606266; }
.stat-row b { color: #303133; }
.canvas-actions { display: flex; flex-direction: column; gap: 8px; }

.empty-hint { display: flex; align-items: center; justify-content: center; color: #909399; font-size: 14px; min-height: 120px; }
.delete-btn { width: 100%; margin-top: 16px; }

.name-overflow { font-size: 13px; color: #f56c6c; user-select: none; }
.field-warning { font-size: 12px; color: #f56c6c; margin-top: 2px; }

.edge-config { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.edge-list { width: 100%; margin-bottom: 8px; }
.edge-item { display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: #f5f7fa; border-radius: 4px; margin-bottom: 4px; font-size: 12px; }
.edge-item .edge-target { flex-shrink: 0; color: #606266; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.field-label { font-size: 12px; color: #303133; }
.field-key { font-size: 11px; color: #909399; margin-left: 4px; }

.condition-branch-list { display: flex; flex-direction: column; gap: 8px; }
.condition-branch {
  background: #f5f7fa; border-radius: 6px; padding: 10px;
}
.branch-header {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: #606266; margin-bottom: 4px;
}
.branch-header-right { display: flex; align-items: center; gap: 4px; }
.branch-label { margin-bottom: 6px; }
.condition-row { display: flex; gap: 6px; }
.cond-field { flex: 1; }
.cond-op { width: 80px; }
.cond-val { flex: 1; }
.condition-preview { font-size: 11px; color: #909399; margin-top: 4px; }
.condition-preview code { color: #409eff; background: #ecf5ff; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
</style>
