import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ---- 默认管理员 ----
  const passwordHash = await bcrypt.hash('123456', 10)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@furm.com' },
    update: {},
    create: {
      email: 'admin@furm.com',
      passwordHash,
      nickname: '管理员',
      status: 'active',
    },
  })
  console.log(`  ✅ 管理员账号: admin@furm.com / 123456`)

  // ---- 默认工作空间 ----
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      name: '默认空间',
      slug: 'default',
      plan: 'enterprise',
      members: {
        create: {
          userId: admin.id,
          role: 'owner',
        },
      },
    },
  })
  console.log(`  ✅ 默认工作空间: ${workspace.name}`)

  // ---- 默认角色 ----
  const adminRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: '管理员' } },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: '管理员',
      permissions: ['*'],
      isSystem: true,
    },
  })

  const editorRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: '编辑者' } },
    update: { permissions: ['form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'submission:create', 'submission:view', 'submission:delete', 'submission:export', 'workflow:start'] },
    create: {
      workspaceId: workspace.id,
      name: '编辑者',
      permissions: ['form:create', 'form:edit', 'form:publish', 'form:archive', 'form:copy', 'submission:create', 'submission:view', 'submission:delete', 'submission:export', 'workflow:start'],
      isSystem: true,
    },
  })

  const viewerRole = await prisma.role.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name: '查看者' } },
    update: { permissions: ['submission:view', 'submission:export', 'analytics:view'] },
    create: {
      workspaceId: workspace.id,
      name: '查看者',
      permissions: ['submission:view', 'submission:export', 'analytics:view'],
      isSystem: true,
    },
  })
  console.log(`  ✅ 默认角色: 管理员 / 编辑者 / 查看者`)

  // ---- 给管理员分配管理员角色 ----
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  })

  // ---- 示例表单 ----
  const demoForm = await prisma.form.upsert({
    where: { id: 'demo-form-001' },
    update: {},
    create: {
      id: 'demo-form-001',
      workspaceId: workspace.id,
      name: '员工信息登记表',
      description: '新员工入职时填写的基本信息',
      status: 'published',
      publishedVersion: 1,
      publishedAt: new Date(),
      createdBy: admin.id,
      updatedBy: admin.id,
      schema: {
        version: '2.0',
        id: 'demo-form-001',
        settings: {
          labelWidth: 100,
          labelPosition: 'right',
          size: 'default',
          disabled: false,
          submitText: '提交',
          resetText: '重置',
          rules: [],
          cssClassName: '',
        },
        fields: [
          {
            id: 'field_name',
            key: 'name',
            type: 'input',
            name: '姓名',
            col: 12,
            props: { placeholder: '请输入姓名', maxLength: 50, clearable: true },
            rules: [{ type: 'required', message: '姓名不能为空' }],
          },
          {
            id: 'field_gender',
            key: 'gender',
            type: 'radio',
            name: '性别',
            col: 12,
            props: {
              options: [
                { label: '男', value: 'male' },
                { label: '女', value: 'female' },
              ],
            },
          },
          {
            id: 'field_dept',
            key: 'department',
            type: 'select',
            name: '部门',
            col: 12,
            props: {
              options: [
                { label: '研发部', value: 'rd' },
                { label: '产品部', value: 'pm' },
                { label: '市场部', value: 'marketing' },
                { label: '人事部', value: 'hr' },
              ],
              filterable: true,
            },
            rules: [{ type: 'required', message: '请选择部门' }],
          },
          {
            id: 'field_email',
            key: 'email',
            type: 'input',
            name: '邮箱',
            col: 12,
            props: { placeholder: '请输入邮箱' },
            rules: [
              { type: 'required', message: '邮箱不能为空' },
              { type: 'email', message: '邮箱格式不正确' },
            ],
          },
          {
            id: 'field_salary',
            key: 'salary',
            type: 'input-number',
            name: '薪资',
            col: 12,
            props: { min: 0, precision: 2, step: 1000 },
            acl: {
              viewable: ['role:管理员', 'role:编辑者'],
              editable: ['role:管理员'],
            },
          },
          {
            id: 'field_remark',
            key: 'remark',
            type: 'textarea',
            name: '备注',
            col: 24,
            props: { rows: 3, maxLength: 500 },
          },
        ],
      },
      settings: {
        labelWidth: 100,
        labelPosition: 'right',
        size: 'default',
      },
    },
  })
  console.log(`  ✅ 示例表单: ${demoForm.name}（含 ACL 示例：薪资字段仅管理员可编辑）`)

  // ---- 版本快照 ----
  await prisma.formVersion.upsert({
    where: { formId_version: { formId: demoForm.id, version: 1 } },
    update: {},
    create: {
      formId: demoForm.id,
      version: 1,
      schema: demoForm.schema as any,
      changeLog: '初始版本',
      createdBy: admin.id,
    },
  })

  // ---- 示例审批流程 ----
  const demoProcess = await prisma.processDefinition.upsert({
    where: { id: 'demo-process-001' },
    update: {},
    create: {
      id: 'demo-process-001',
      workspaceId: workspace.id,
      name: '请假审批流程',
      description: '员工请假需要直属上级审批，超过3天需部门负责人加签',
      status: 'published',
      version: 1,
      createdBy: admin.id,
      nodes: [
        { id: 'start', type: 'start', name: '开始', position: { x: 200, y: 50 }, config: {} },
        {
          id: 'node_approval_1',
          type: 'approval',
          name: '直属上级审批',
          position: { x: 200, y: 150 },
          config: {
            type: 'single',
            assignees: ['${deptManager}'],
            strategy: { type: 'all' },
            timeout: 48,
            allowTransfer: true,
            allowAddSign: false,
          },
        },
        {
          id: 'node_condition',
          type: 'condition',
          name: '是否超过3天',
          position: { x: 200, y: 260 },
          config: {
            branches: [
              { id: 'br1', name: '不超过3天', condition: 'days <= 3', targetNodeId: 'end' },
              { id: 'br2', name: '超过3天', condition: 'days > 3', targetNodeId: 'node_approval_2' },
            ],
            defaultBranch: 'end',
          },
        },
        {
          id: 'node_approval_2',
          type: 'approval',
          name: '部门负责人审批',
          position: { x: 200, y: 350 },
          config: {
            type: 'single',
            assignees: ['${deptHead}'],
            strategy: { type: 'all' },
            timeout: 24,
            allowTransfer: false,
            allowAddSign: true,
          },
        },
        { id: 'end', type: 'end', name: '结束', position: { x: 200, y: 460 }, config: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'start', targetNodeId: 'node_approval_1' },
        { id: 'e2', sourceNodeId: 'node_approval_1', targetNodeId: 'node_condition' },
      ],
      settings: { allowWithdraw: true, allowUrge: true, urgeTimeout: 24 },
    },
  })
  console.log(`  ✅ 示例流程: ${demoProcess.name}（含条件分支 + 多级审批）`)

  console.log('\n🎉 Seed 完成！')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
