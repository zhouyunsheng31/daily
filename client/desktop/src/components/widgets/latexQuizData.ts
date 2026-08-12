import type { QuizQuestion } from '../../types'

// Phase 4A: Preset question bank (16 questions, 4 per category)
// All answers manually verified.

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  // ===== Algebra (4) =====
  {
    id: 'alg-1',
    category: 'algebra',
    prompt: '解方程 $2x + 5 = 13$',
    latex: '2x + 5 = 13',
    answer: '4',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '移项：$2x = 13 - 5 = 8$，再除以 2：$x = 4$',
  },
  {
    id: 'alg-2',
    category: 'algebra',
    prompt: '求 $\\sqrt{49}$ 的值',
    latex: '\\sqrt{49}',
    answer: '7',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '$\\sqrt{49} = 7$，因为 $7^2 = 49$',
  },
  {
    id: 'alg-3',
    category: 'algebra',
    prompt: '化简 $3(x - 2) + 4x$',
    latex: '3(x - 2) + 4x',
    answer: '7x-6',
    answerType: 'exact',
    explanation: '展开 $3x - 6 + 4x = 7x - 6$',
  },
  {
    id: 'alg-4',
    category: 'algebra',
    prompt: '解方程 $x^2 - 9 = 0$，求较大根',
    latex: 'x^2 - 9 = 0',
    answer: '3',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '$(x-3)(x+3)=0$，较大根为 $x = 3$',
  },

  // ===== Geometry (4) =====
  {
    id: 'geo-1',
    category: 'geometry',
    prompt: '半径为 $r = 5$ 的圆，面积是多少？（取 $\\pi \\approx 3.14159$）',
    latex: '\\pi r^2, r = 5',
    answer: '78.5398',
    answerType: 'numeric',
    tolerance: 0.01,
    explanation: '面积 $= \\pi r^2 = 3.14159 \\times 25 \\approx 78.54$',
  },
  {
    id: 'geo-2',
    category: 'geometry',
    prompt: '正方形边长为 $a = 6$，周长是多少？',
    latex: '4a, a = 6',
    answer: '24',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '周长 $= 4a = 4 \\times 6 = 24$',
  },
  {
    id: 'geo-3',
    category: 'geometry',
    prompt: '直角三角形两直角边为 $a = 3$、$b = 4$，斜边 $c$ 是多少？',
    latex: 'c = \\sqrt{a^2 + b^2}',
    answer: '5',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '勾股定理：$c = \\sqrt{3^2 + 4^2} = \\sqrt{25} = 5$',
  },
  {
    id: 'geo-4',
    category: 'geometry',
    prompt: '球体体积公式 $V = \\frac{4}{3}\\pi r^3$，当 $r = 3$ 时体积约是多少？',
    latex: 'V = \\frac{4}{3}\\pi r^3, r = 3',
    answer: '113.0973',
    answerType: 'numeric',
    tolerance: 0.01,
    explanation: '$V = \\frac{4}{3} \\times 3.14159 \\times 27 \\approx 113.10$',
  },

  // ===== Calculus (4) =====
  {
    id: 'cal-1',
    category: 'calculus',
    prompt: '求 $f(x) = x^2$ 的导数 $f\'(x)$',
    latex: "f(x) = x^2, f'(x) = ?",
    answer: '2x',
    answerType: 'exact',
    explanation: '幂函数求导公式：$(x^n)\' = nx^{n-1}$，所以 $(x^2)\' = 2x$',
  },
  {
    id: 'cal-2',
    category: 'calculus',
    prompt: '求 $f(x) = \\sin(x)$ 的导数 $f\'(x)$',
    latex: "f(x) = \\sin(x), f'(x) = ?",
    answer: 'cos(x)',
    answerType: 'exact',
    explanation: '基本求导公式：$(\\sin x)\' = \\cos x$',
  },
  {
    id: 'cal-3',
    category: 'calculus',
    prompt: '求 $\\int 1 \\, dx$（不定积分）',
    latex: '\\int 1 \\, dx = ?',
    answer: 'x+C',
    answerType: 'exact',
    explanation: '$\\int 1 \\, dx = x + C$，其中 $C$ 是任意常数',
  },
  {
    id: 'cal-4',
    category: 'calculus',
    prompt: '求极限 $\\lim_{x \\to 0} \\frac{\\sin(x)}{x}$',
    latex: '\\lim_{x \\to 0} \\frac{\\sin(x)}{x}',
    answer: '1',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '这是基本极限，结果为 1',
  },

  // ===== Trigonometry (4) =====
  {
    id: 'tri-1',
    category: 'trig',
    prompt: '求 $\\sin(30°)$ 的值（弧度制为 $\\sin(\\pi/6)$）',
    latex: '\\sin(30°) = \\sin(\\pi/6)',
    answer: '0.5',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '$\\sin(30°) = 0.5$，是基本三角函数值',
  },
  {
    id: 'tri-2',
    category: 'trig',
    prompt: '求 $\\cos(60°)$ 的值',
    latex: '\\cos(60°) = \\cos(\\pi/3)',
    answer: '0.5',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '$\\cos(60°) = 0.5$',
  },
  {
    id: 'tri-3',
    category: 'trig',
    prompt: '求 $\\tan(45°)$ 的值',
    latex: '\\tan(45°) = \\tan(\\pi/4)',
    answer: '1',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '$\\tan(45°) = 1$',
  },
  {
    id: 'tri-4',
    category: 'trig',
    prompt: '$\\sin^2(\\theta) + \\cos^2(\\theta) = ?$（提示：基本恒等式）',
    latex: '\\sin^2(\\theta) + \\cos^2(\\theta)',
    answer: '1',
    answerType: 'numeric',
    tolerance: 0.0001,
    explanation: '毕达哥拉斯三角恒等式：$\\sin^2\\theta + \\cos^2\\theta = 1$',
  },
] as const

export function getQuestionsByCategory(category: 'algebra' | 'geometry' | 'calculus' | 'trig'): QuizQuestion[] {
  return QUIZ_QUESTIONS.filter(q => q.category === category)
}

export function getQuestionById(id: string): QuizQuestion | undefined {
  return QUIZ_QUESTIONS.find(q => q.id === id)
}

export function resolveQuestionsByIds(ids: string[]): QuizQuestion[] {
  return ids
    .map(id => getQuestionById(id))
    .filter((q): q is QuizQuestion => q !== undefined)
}
