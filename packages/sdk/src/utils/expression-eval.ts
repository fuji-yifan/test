/**
 * 安全的 DSL 表达式求值引擎
 *
 * 不使用 eval/Function，采用 AST 解释器方式执行。
 * 支持的语法：
 *   比较:  >  <  >=  <=  ==  !=  ===  !==
 *   逻辑:  &&  ||  !
 *   算术:  +  -  *  /  %
 *   三元:  ? :
 *   字面量:  number, string (single/double quote), true/false, null, undefined
 *   变量:  从 context 中取值（点号访问）
 *   函数:  内置函数 includes, isEmpty, len, toNumber, now 等
 */

// ==================== 词法分析 (Lexer) ====================

type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'true'
  | 'false'
  | 'null'
  | 'undefined'
  | 'plus'        // +
  | 'minus'       // -
  | 'star'        // *
  | 'slash'       // /
  | 'percent'     // %
  | 'eq'          // ==
  | 'notEq'       // !=
  | 'strictEq'    // ===
  | 'strictNotEq' // !==
  | 'gt'          // >
  | 'gte'         // >=
  | 'lt'          // <
  | 'lte'         // <=
  | 'and'         // &&
  | 'or'          // ||
  | 'not'         // !
  | 'question'    // ?
  | 'colon'       // :
  | 'dot'         // .
  | 'lparen'      // (
  | 'rparen'      // )
  | 'lbracket'    // [
  | 'rbracket'    // ]
  | 'comma'       // ,
  | 'eof'

interface Token {
  type: TokenType
  value: any
  pos: number
}

class Lexer {
  private pos = 0

  constructor(private input: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = []
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]

      // 空白跳过
      if (/\s/.test(ch)) {
        this.pos++
        continue
      }

      // 数字
      if (/\d/.test(ch)) {
        tokens.push(this.readNumber())
        continue
      }

      // 字符串
      if (ch === "'" || ch === '"') {
        tokens.push(this.readString(ch))
        continue
      }

      // 标识符 / 关键字 / 函数名
      if (/[a-zA-Z_$]/.test(ch)) {
        tokens.push(this.readIdentifier())
        continue
      }

      // 双字符操作符
      if (ch === '=' && this.peek() === '=') {
        this.pos += 2
        tokens.push(this.tok('eq', '=='))
        continue
      }
      if (ch === '!' && this.peek() === '=') {
        this.pos += 2
        tokens.push(this.tok('notEq', '!='))
        continue
      }
      if (ch === '=' && this.peek() === '=' && this.peek(1) === '=') {
        this.pos += 3
        tokens.push(this.tok('strictEq', '==='))
        continue
      }
      if (ch === '!' && this.peek() === '=' && this.peek(1) === '=') {
        this.pos += 3
        tokens.push(this.tok('strictNotEq', '!=='))
        continue
      }
      if (ch === '>' && this.peek() === '=') {
        this.pos += 2
        tokens.push(this.tok('gte', '>='))
        continue
      }
      if (ch === '<' && this.peek() === '=') {
        this.pos += 2
        tokens.push(this.tok('lte', '<='))
        continue
      }
      if (ch === '&' && this.peek() === '&') {
        this.pos += 2
        tokens.push(this.tok('and', '&&'))
        continue
      }
      if (ch === '|' && this.peek() === '|') {
        this.pos += 2
        tokens.push(this.tok('or', '||'))
        continue
      }

      // 单字符操作符
      const singleCharMap: Record<string, TokenType> = {
        '+': 'plus',
        '-': 'minus',
        '*': 'star',
        '/': 'slash',
        '%': 'percent',
        '>': 'gt',
        '<': 'lt',
        '!': 'not',
        '?': 'question',
        ':': 'colon',
        '.': 'dot',
        '(': 'lparen',
        ')': 'rparen',
        '[': 'lbracket',
        ']': 'rbracket',
        ',': 'comma',
      }
      if (singleCharMap[ch]) {
        tokens.push(this.tok(singleCharMap[ch], ch))
        this.pos++
        continue
      }

      throw new Error(`Unexpected character "${ch}" at position ${this.pos}`)
    }
    tokens.push(this.tok('eof', ''))
    return tokens
  }

  private readNumber(): Token {
    const start = this.pos
    let hasDecimal = false
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]
      if (ch === '.' && !hasDecimal) {
        hasDecimal = true
        this.pos++
      } else if (/\d/.test(ch)) {
        this.pos++
      } else {
        break
      }
    }
    const numStr = this.input.slice(start, this.pos)
    return this.tok('number', parseFloat(numStr))
  }

  private readString(quote: string): Token {
    this.pos++ // skip opening quote
    const start = this.pos
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') this.pos++ // skip escape
      this.pos++
    }
    const value = this.input.slice(start, this.pos)
    this.pos++ // skip closing quote
    return this.tok('string', value)
  }

  private readIdentifier(): Token {
    const start = this.pos
    while (this.pos < this.input.length && /[a-zA-Z0-9_$]/.test(this.input[this.pos])) {
      this.pos++
    }
    const word = this.input.slice(start, this.pos)
    const keywordMap: Record<string, TokenType> = {
      true: 'true',
      false: 'false',
      null: 'null',
      undefined: 'undefined',
    }
    if (keywordMap[word]) {
      return this.tok(keywordMap[word], word === 'true' ? true : word === 'false' ? false : null)
    }
    return this.tok('identifier', word)
  }

  private peek(offset = 1): string {
    return this.input[this.pos + offset] ?? ''
  }

  private tok(type: TokenType, value: any): Token {
    return { type, value, pos: this.pos }
  }
}

// ==================== 语法分析 & 解释执行 (Parser + Evaluator) ====================

class Parser {
  private pos = 0
  private tokens: Token[]
  private customFns: Map<string, (...args: any[]) => any>

  constructor(tokens: Token[], customFns?: Map<string, (...args: any[]) => any>) {
    this.tokens = tokens
    this.customFns = customFns || new Map()
  }

  parse(context: Record<string, any>): any {
    const result = this.expression(context)
    this.expect('eof')
    return result
  }

  // expression → ternary
  private expression(ctx: Record<string, any>): any {
    return this.ternary(ctx)
  }

  // ternary → logical ( '?' expression ':' expression )?
  private ternary(ctx: Record<string, any>): any {
    const condition = this.logical(ctx)
    if (this.match('question')) {
      this.advance()
      const thenVal = this.expression(ctx)
      this.expect('colon')
      this.advance()
      const elseVal = this.expression(ctx)
      return condition ? thenVal : elseVal
    }
    return condition
  }

  // logical → comparison ( ('&&' | '||') comparison )*
  private logical(ctx: Record<string, any>): any {
    let left = this.comparison(ctx)
    while (this.match('and') || this.match('or')) {
      const op = this.currentToken()!.type
      this.advance()
      const right = this.comparison(ctx)
      if (op === 'and') {
        left = left && right
      } else {
        left = left || right
      }
    }
    return left
  }

  // comparison → additive ( ('>' | '>=' | '<' | '<=' | '==' | '!=' | '===' | '!==') additive )?
  private comparison(ctx: Record<string, any>): any {
    const left = this.additive(ctx)
    const compOps: TokenType[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'notEq', 'strictEq', 'strictNotEq']
    if (compOps.some((op) => this.match(op))) {
      const op = this.currentToken()!.type
      this.advance()
      const right = this.additive(ctx)
      switch (op) {
        case 'gt': return left > right
        case 'gte': return left >= right
        case 'lt': return left < right
        case 'lte': return left <= right
        case 'eq': return left == right
        case 'notEq': return left != right
        case 'strictEq': return left === right
        case 'strictNotEq': return left !== right
      }
    }
    return left
  }

  // additive → unary ( ('+' | '-') unary )*
  private additive(ctx: Record<string, any>): any {
    let left = this.unary(ctx)
    while (this.match('plus') || this.match('minus')) {
      const op = this.currentToken()!.type
      this.advance()
      const right = this.unary(ctx)
      if (op === 'plus') left = left + right
      else left = left - right
    }
    return left
  }

  // unary → '!' unary | primary ( ('*' | '/' | '%') primary )*
  private unary(ctx: Record<string, any>): any {
    if (this.match('not')) {
      this.advance()
      return !this.unary(ctx)
    }
    let left = this.functionCall(ctx)
    while (this.match('star') || this.match('slash') || this.match('percent')) {
      const op = this.currentToken()!.type
      this.advance()
      const right = this.primary(ctx)
      if (op === 'star') left = left * right
      else if (op === 'slash') left = left / right
      else left = left % right
    }
    return left
  }

  // functionCall → identifier '(' args ')' | primary
  private functionCall(ctx: Record<string, any>): any {
    if (this.match('identifier') && this.peekToken()?.type === 'lparen') {
      const fnName = this.currentToken()!.value as string
      this.advance() // identifier
      this.advance() // '('
      const args: any[] = []
      if (!this.match('rparen')) {
        args.push(this.expression(ctx))
        while (this.match('comma')) {
          this.advance()
          args.push(this.expression(ctx))
        }
      }
      this.expect('rparen')
      this.advance() // ')'
      return this.callBuiltin(fnName, args)
    }
    return this.primary(ctx)
  }

  // primary → number | string | true | false | null | undefined | identifier ( '.' identifier | '[' expression ']' )* | '(' expression ')'
  private primary(ctx: Record<string, any>): any {
    const tok = this.currentToken()

    if (this.match('number')) {
      this.advance()
      return tok!.value
    }
    if (this.match('string')) {
      this.advance()
      return tok!.value
    }
    if (this.match('true') || this.match('false') || this.match('null') || this.match('undefined')) {
      this.advance()
      return tok!.value
    }

    if (this.match('lparen')) {
      this.advance() // '('
      const val = this.expression(ctx)
      this.expect('rparen')
      this.advance() // ')'
      return val
    }

    if (this.match('identifier')) {
      this.advance()
      let value: any = this.resolveIdentifier(tok!.value, ctx)
      // 属性访问: ident.prop 或 ident[expr]
      while (this.match('dot') || this.match('lbracket')) {
        if (this.match('dot')) {
          this.advance() // '.'
          const propTok = this.currentToken()
          this.expect('identifier')
          this.advance()
          value = value?.[propTok!.value]
        } else {
          this.advance() // '['
          const idx = this.expression(ctx)
          this.expect('rbracket')
          this.advance() // ']'
          value = value?.[idx]
        }
      }
      return value
    }

    throw new Error(`Unexpected token "${tok?.type}" at position ${tok?.pos}`)
  }

  private resolveIdentifier(name: string, ctx: Record<string, any>): any {
    return ctx[name]
  }

  protected callBuiltin(name: string, args: any[]): any {
    // 1. 先查自定义函数表
    if (this.customFns.has(name)) {
      return this.customFns.get(name)!(...args)
    }
    // 2. 再查内置函数
    switch (name) {
      case 'includes':
        return String(args[0]).includes(String(args[1]))
      case 'isEmpty':
        return args[0] === null || args[0] === undefined || args[0] === '' ||
          (Array.isArray(args[0]) && args[0].length === 0)
      case 'len':
        return args[0]?.length ?? 0
      case 'toNumber':
        return Number(args[0])
      case 'now':
        return Date.now()
      case 'toString':
        return String(args[0])
      case 'toLowerCase':
        return String(args[0]).toLowerCase()
      case 'toUpperCase':
        return String(args[0]).toUpperCase()
      case 'trim':
        return String(args[0]).trim()
      case 'startsWith':
        return String(args[0]).startsWith(String(args[1]))
      case 'endsWith':
        return String(args[0]).endsWith(String(args[1]))
      default:
        throw new Error(`Unknown function "${name}"`)
    }
  }

  private currentToken(): Token | null {
    return this.tokens[this.pos] ?? null
  }

  private peekToken(): Token | null {
    return this.tokens[this.pos + 1] ?? null
  }

  private match(type: TokenType): boolean {
    return this.currentToken()?.type === type
  }

  private advance(): void {
    this.pos++
  }

  private expect(type: TokenType): void {
    if (!this.match(type)) {
      throw new Error(
        `Expected token "${type}" but got "${this.currentToken()?.type}" at pos ${this.currentToken()?.pos}`,
      )
    }
  }
}

// ==================== 公开 API ====================

/**
 * 求值 DSL 表达式
 * @param expression 表达式字符串，如 "age > 18 && gender === 'male'"
 * @param context 变量上下文字典
 * @returns 求值结果（boolean | number | string | ...）
 */
export function evaluate(expression: string, context: Record<string, any>): any {
  if (!expression || !expression.trim()) return true
  const lexer = new Lexer(expression.trim())
  const tokens = lexer.tokenize()
  const parser = new Parser(tokens)
  return parser.parse(context)
}

/**
 * 快速测试表达式是否有效（语法检查）
 */
export function validateExpression(expression: string): { valid: boolean; error?: string } {
  try {
    const lexer = new Lexer(expression.trim())
    const tokens = lexer.tokenize()
    const parser = new Parser(tokens)
    parser.parse({})
    return { valid: true }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}

// ==================== IExpressionEngine 接口 ====================

export interface IExpressionEngine {
  /** 求值表达式 */
  evaluate(expression: string, context: Record<string, any>): any

  /** 语法校验（设计时使用——属性面板实时提示语法错误） */
  validate(expression: string): { valid: boolean; error?: string; pos?: number }

  /** 注册自定义函数（扩展表达式语法） */
  registerFunction(name: string, fn: (...args: any[]) => any): void

  /** 提取表达式中引用的所有变量名（用于依赖分析） */
  extractVariables(expression: string): string[]
}

// ==================== ExpressionEngine 实现类 ====================

/**
 * ExpressionEngine — 自研 DSL 表达式引擎
 *
 * 基于手写递归下降 AST 解释器，不依赖 eval/Function，完全沙箱隔离。
 * 约 400 行 TypeScript，压缩后约 3KB。
 */
export class ExpressionEngine implements IExpressionEngine {
  private customFunctions = new Map<string, (...args: any[]) => any>()
  private static _instance: ExpressionEngine

  static getInstance(): ExpressionEngine {
    if (!ExpressionEngine._instance) {
      ExpressionEngine._instance = new ExpressionEngine()
    }
    return ExpressionEngine._instance
  }

  evaluate(expression: string, context: Record<string, any>): any {
    if (!expression?.trim()) return true

    // 将自定义函数注入 context（方便表达式直接调用）
    const enrichedContext = { ...context }
    this.customFunctions.forEach((fn, name) => {
      if (!(name in enrichedContext)) {
        enrichedContext[name] = fn
      }
    })

    const trimmed = expression.trim()
    const lexer = new Lexer(trimmed)
    const tokens = lexer.tokenize()
    const parser = new Parser(tokens, this.customFunctions)
    const result = parser.parse(enrichedContext)
    return result
  }

  validate(expression: string): { valid: boolean; error?: string; pos?: number } {
    return validateExpression(expression) as { valid: boolean; error?: string; pos?: number }
  }

  registerFunction(name: string, fn: (...args: any[]) => any): void {
    if (this.customFunctions.has(name)) {
      console.warn(`[ExpressionEngine] 函数 "${name}" 已注册，将被覆盖`)
    }
    this.customFunctions.set(name, fn)
  }

  extractVariables(expression: string): string[] {
    if (!expression?.trim()) return []
    try {
      const lexer = new Lexer(expression.trim())
      const tokens = lexer.tokenize()
      const variables = new Set<string>()
      for (const tk of tokens) {
        if (
          tk.type === 'identifier' &&
          !['true', 'false', 'null', 'undefined'].includes(tk.value) &&
          !this.customFunctions.has(tk.value) &&
          !BUILTIN_FN_NAMES.has(tk.value)
        ) {
          variables.add(tk.value as string)
        }
      }
      return Array.from(variables)
    } catch {
      return []
    }
  }

  /** 移除已注册的自定义函数 */
  unregisterFunction(name: string): void {
    this.customFunctions.delete(name)
  }
}

/** 内置函数名集合（用于 extractVariables 排除） */
const BUILTIN_FN_NAMES = new Set([
  'includes', 'isEmpty', 'len', 'toNumber', 'now', 'toString',
  'toLowerCase', 'toUpperCase', 'trim', 'startsWith', 'endsWith',
])

/** 便捷单例 */
export const expressionEngine = ExpressionEngine.getInstance()
