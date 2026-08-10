import { Injectable } from '@nestjs/common'
import { Tool } from '../../../harness/tool.decorator'
import { z } from 'zod'

@Injectable()
@Tool({
  name: 'form_search_field_pool',
  description: '从标准字段池中检索候选字段。给定一个业务领域（如 customer/order/HR），返回匹配的字段列表，供用户选择用于表单搭建。',
  inputSchema: z.object({
    domain: z.string().optional().default('general').describe('业务领域，如 customer, order, HR, finance, reimbursement, supply-chain, general'),
    keyword: z.string().optional().describe('可选的额外关键词过滤'),
  }),
  riskLevel: 'low',
})
export class FormSearchFieldPoolTool {
  private fieldPool: Record<string, Array<{ key: string; name: string; type: string; commonRules: string[] }>> = {
    customer: [
      { key: 'customer_name', name: '客户姓名', type: 'input', commonRules: ['required', 'string'] },
      { key: 'mobile_phone', name: '手机号码', type: 'input', commonRules: ['required', 'pattern'] },
      { key: 'email', name: '电子邮箱', type: 'input', commonRules: ['email'] },
      { key: 'company', name: '所属公司', type: 'select', commonRules: [] },
      { key: 'contact_address', name: '联系地址', type: 'textarea', commonRules: [] },
      { key: 'customer_level', name: '客户等级', type: 'radio', commonRules: [] },
      { key: 'remark', name: '备注', type: 'textarea', commonRules: [] },
    ],
    order: [
      { key: 'order_no', name: '订单号', type: 'input', commonRules: ['required'] },
      { key: 'order_date', name: '订单日期', type: 'date-picker', commonRules: ['required'] },
      { key: 'product_name', name: '产品名称', type: 'input', commonRules: ['required'] },
      { key: 'quantity', name: '数量', type: 'input-number', commonRules: ['required', 'number'] },
      { key: 'unit_price', name: '单价', type: 'input-number', commonRules: ['number'] },
      { key: 'total_amount', name: '总金额', type: 'input-number', commonRules: ['required', 'number'] },
    ],
    HR: [
      { key: 'employee_name', name: '员工姓名', type: 'input', commonRules: ['required'] },
      { key: 'department', name: '部门', type: 'select', commonRules: [] },
      { key: 'position', name: '岗位', type: 'input', commonRules: [] },
      { key: 'entry_date', name: '入职日期', type: 'date-picker', commonRules: [] },
      { key: 'leave_date', name: '离职日期', type: 'date-picker', commonRules: [] },
      { key: 'reason', name: '原因说明', type: 'textarea', commonRules: [] },
    ],
    finance: [
      { key: 'expense_type', name: '费用类型', type: 'select', commonRules: ['required'] },
      { key: 'amount', name: '金额', type: 'input-number', commonRules: ['required', 'number'] },
      { key: 'expense_date', name: '发生日期', type: 'date-picker', commonRules: ['required'] },
      { key: 'invoice_no', name: '发票号', type: 'input', commonRules: [] },
      { key: 'description', name: '用途说明', type: 'textarea', commonRules: ['required'] },
    ],
    'supply-chain': [
      { key: 'item_name', name: '物料名称', type: 'input', commonRules: ['required'] },
      { key: 'supplier', name: '供应商', type: 'select', commonRules: [] },
      { key: 'quantity', name: '数量', type: 'input-number', commonRules: ['required', 'number'] },
      { key: 'delivery_date', name: '交付日期', type: 'date-picker', commonRules: [] },
      { key: 'quality_check', name: '质检结果', type: 'radio', commonRules: [] },
    ],
    student: [
      { key: 'student_name', name: '姓名', type: 'input', commonRules: ['required'] },
      { key: 'mobile_phone', name: '手机号', type: 'input', commonRules: ['required', 'pattern'] },
      { key: 'age', name: '年龄', type: 'input-number', commonRules: ['number'] },
      { key: 'gender', name: '性别', type: 'radio', commonRules: [] },
      { key: 'major', name: '专业', type: 'input', commonRules: [] },
      { key: 'class_name', name: '班级', type: 'select', commonRules: [] },
      { key: 'student_id', name: '学号', type: 'input', commonRules: ['required'] },
    ],
    reimbursement: [
      { key: 'expense_title', name: '报销标题', type: 'input', commonRules: ['required', 'string'] },
      { key: 'applicant_name', name: '报销人', type: 'input', commonRules: ['required', 'string'] },
      { key: 'department', name: '报销部门', type: 'select', commonRules: ['required'] },
      { key: 'expense_type', name: '报销类别', type: 'select', commonRules: ['required'] },
      { key: 'expense_amount', name: '报销金额', type: 'input-number', commonRules: ['required', 'number'] },
      { key: 'expense_date', name: '费用发生日期', type: 'date-picker', commonRules: ['required'] },
      { key: 'expense_description', name: '费用说明', type: 'textarea', commonRules: ['required'] },
      { key: 'invoice_attachment', name: '发票附件', type: 'file-upload', commonRules: [] },
      { key: 'remark', name: '备注', type: 'textarea', commonRules: [] },
      { key: 'approval_comment', name: '审批意见', type: 'textarea', commonRules: [] },
    ],
    general: [
      { key: 'name', name: '名称', type: 'input', commonRules: ['required'] },
      { key: 'phone', name: '手机号', type: 'input', commonRules: ['pattern'] },
      { key: 'email', name: '邮箱', type: 'input', commonRules: ['email'] },
      { key: 'remark', name: '备注', type: 'textarea', commonRules: [] },
      { key: 'date', name: '日期', type: 'date-picker', commonRules: [] },
    ],
  }

  async execute(args: { domain?: string; keyword?: string }): Promise<any> {
    const domain = args.domain || 'general'
    const pool = this.fieldPool[domain] || this.fieldPool['general']
    let results = pool
    if (args.keyword) {
      const kw = args.keyword.toLowerCase()
      results = pool.filter(
        (f) => f.name.includes(kw) || f.key.includes(kw) || f.type.includes(kw),
      )
    }
    return {
      summary: `Found ${results.length} fields for domain "${domain}"`,
      fields: results,
    }
  }
}
