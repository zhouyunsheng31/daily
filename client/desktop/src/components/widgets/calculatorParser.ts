// Calculator expression parser
// Phase 4A: No eval, no Function constructor
// Supports: numbers, +-*/^, parentheses, functions (sin, cos, tan, asin, acos, atan, log, ln, sqrt, abs, exp), constants (pi, e), implicit multiplication

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'fn'; name: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'ident'; name: string }

const FUNCTIONS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

const MAX_INPUT_LENGTH = 200
const MAX_TOKEN_COUNT = 128
const MAX_NESTING_DEPTH = 32
const ALLOWED_CHARS_PATTERN = /^[a-zA-Z0-9+\-*/^().,\s]+$/

function isLetter(ch: string): boolean {
  return /[a-zA-Z]/.test(ch)
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch)
}

function tokenize(input: string): Token[] {
  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error('表达式过长（超过 200 字符）')
  }
  if (!ALLOWED_CHARS_PATTERN.test(input)) {
    throw new Error('包含非法字符')
  }

  const tokens: Token[] = []
  let i = 0
  let prev: Token | null = null
  let parenDepth = 0

  while (i < input.length) {
    const ch = input[i]

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === ',') {
      i++
      continue
    }

    // Number
    if (isDigit(ch) || (ch === '.' && i + 1 < input.length && isDigit(input[i + 1]))) {
      let j = i
      while (j < input.length && (isDigit(input[j]) || input[j] === '.')) j++
      const numStr = input.slice(i, j)
      const value = Number(numStr)
      if (!Number.isFinite(value)) throw new Error('数字格式错误')
      tokens.push({ type: 'num', value })
      prev = tokens[tokens.length - 1]
      i = j
      continue
    }

    // Identifier (function name or constant)
    if (isLetter(ch)) {
      let j = i
      while (j < input.length && isLetter(input[j])) j++
      const name = input.slice(i, j).toLowerCase()

      if (CONSTANTS[name] !== undefined) {
        tokens.push({ type: 'ident', name })
      } else if (FUNCTIONS[name] !== undefined) {
        tokens.push({ type: 'fn', name })
      } else {
        throw new Error(`未知函数或常量: ${name}`)
      }
      prev = tokens[tokens.length - 1]
      i = j
      continue
    }

    if (ch === '(') {
      parenDepth++
      if (parenDepth > MAX_NESTING_DEPTH) throw new Error('括号嵌套过深')
      tokens.push({ type: 'lparen' })
      prev = tokens[tokens.length - 1]
      i++
      continue
    }
    if (ch === ')') {
      parenDepth--
      if (parenDepth < 0) throw new Error('括号不匹配')
      tokens.push({ type: 'rparen' })
      prev = tokens[tokens.length - 1]
      i++
      continue
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '%') {
      // Determine unary vs binary
      const isUnary =
        prev === null ||
        prev.type === 'op' ||
        prev.type === 'lparen' ||
        (prev.type === 'fn')

      if (isUnary && (ch === '-' || ch === '+')) {
        // Emit '0' then operator to normalize unary to binary
        tokens.push({ type: 'num', value: 0 })
        tokens.push({ type: 'op', value: ch })
        prev = tokens[tokens.length - 1]
        i++
        continue
      }

      tokens.push({ type: 'op', value: ch })
      prev = tokens[tokens.length - 1]
      i++
      continue
    }

    throw new Error(`未识别的字符: ${ch}`)
  }

  if (parenDepth !== 0) throw new Error('括号不匹配')
  if (tokens.length > MAX_TOKEN_COUNT) throw new Error('表达式过于复杂')

  // Insert implicit multiplication: handle cases like 2pi, 2sin(x), (2)(3), (2)pi, )2
  const result: Token[] = []
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k]
    const last = result[result.length - 1]
    if (
      last &&
      (cur.type === 'ident' || cur.type === 'fn' || cur.type === 'lparen') &&
      (last.type === 'num' || last.type === 'rparen' || last.type === 'ident')
    ) {
      // Implicit multiplication
      result.push({ type: 'op', value: '*' })
    }
    result.push(cur)
  }

  return result
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = []
  const opStack: Token[] = []
  const PRECEDENCE: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
    '^': 3,
  }
  const RIGHT_ASSOC = new Set(['^'])

  for (const token of tokens) {
    if (token.type === 'num' || token.type === 'ident') {
      output.push(token)
    } else if (token.type === 'fn') {
      opStack.push(token)
    } else if (token.type === 'op') {
      while (opStack.length > 0) {
        const top = opStack[opStack.length - 1]
        if (top.type === 'op') {
          const topPrec = PRECEDENCE[top.value]
          const curPrec = PRECEDENCE[token.value]
          if (
            topPrec > curPrec ||
            (topPrec === curPrec && !RIGHT_ASSOC.has(token.value))
          ) {
            output.push(opStack.pop()!)
          } else {
            break
          }
        } else if (top.type === 'fn') {
          output.push(opStack.pop()!)
        } else {
          break
        }
      }
      opStack.push(token)
    } else if (token.type === 'lparen') {
      opStack.push(token)
    } else if (token.type === 'rparen') {
      let foundLparen = false
      while (opStack.length > 0) {
        const top = opStack.pop()!
        if (top.type === 'lparen') {
          foundLparen = true
          break
        }
        output.push(top)
      }
      if (!foundLparen) throw new Error('括号不匹配')
      // If top of opStack is a function, pop it
      if (opStack.length > 0 && opStack[opStack.length - 1].type === 'fn') {
        output.push(opStack.pop()!)
      }
    }
  }

  while (opStack.length > 0) {
    const top = opStack.pop()!
    if (top.type === 'lparen' || top.type === 'rparen') {
      throw new Error('括号不匹配')
    }
    output.push(top)
  }

  return output
}

function evalRPN(rpn: Token[]): number {
  const stack: number[] = []
  for (const token of rpn) {
    if (token.type === 'num') {
      stack.push(token.value)
    } else if (token.type === 'ident') {
      const value = CONSTANTS[token.name]
      if (value === undefined) throw new Error(`未知常量: ${token.name}`)
      stack.push(value)
    } else if (token.type === 'op') {
      if (stack.length < 2) throw new Error('运算符缺少操作数')
      const b = stack.pop()!
      const a = stack.pop()!
      let result: number
      switch (token.value) {
        case '+': result = a + b; break
        case '-': result = a - b; break
        case '*': result = a * b; break
        case '/':
          if (b === 0) throw new Error('除数不能为零')
          result = a / b
          break
        case '%':
          if (b === 0) throw new Error('除数不能为零')
          result = a % b
          break
        case '^': result = Math.pow(a, b); break
        default: throw new Error(`未知运算符: ${token.value}`)
      }
      if (!Number.isFinite(result)) throw new Error('数学错误')
      stack.push(result)
    } else if (token.type === 'fn') {
      if (stack.length < 1) throw new Error('函数缺少参数')
      const arg = stack.pop()!
      const fn = FUNCTIONS[token.name]
      if (!fn) throw new Error(`未知函数: ${token.name}`)
      if (token.name === 'sqrt' && arg < 0) throw new Error('负数无法开方')
      if ((token.name === 'log' || token.name === 'ln') && arg <= 0) throw new Error('对数参数必须大于零')
      const result = fn(arg)
      if (!Number.isFinite(result)) throw new Error('数学错误')
      stack.push(result)
    }
  }
  if (stack.length !== 1) throw new Error('表达式错误')
  return stack[0]
}

export type EvaluateResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

export function evaluate(expression: string): EvaluateResult {
  const trimmed = expression.trim()
  if (trimmed === '') {
    return { ok: false, error: '' }
  }
  try {
    const tokens = tokenize(trimmed)
    if (tokens.length === 0) {
      return { ok: false, error: '' }
    }
    const rpn = toRPN(tokens)
    const value = evalRPN(rpn)
    if (!Number.isFinite(value)) return { ok: false, error: '数学错误' }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '未知错误' }
  }
}

export function formatResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return value.toString()
  }
  // Use up to 12 significant digits
  if (Math.abs(value) < 1e-6 || Math.abs(value) >= 1e15) {
    return value.toExponential(8)
  }
  return Number(value.toPrecision(12)).toString()
}
