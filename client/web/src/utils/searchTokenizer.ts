const STOP_WORDS = new Set([
  // 中文停用词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '这', '那', '里', '为', '什么', '怎么', '可以',
  // 英文停用词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
])

let segmenter: Intl.Segmenter | null = null
function getSegmenter(): Intl.Segmenter {
  if (!segmenter) {
    segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  }
  return segmenter
}

export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return []
  const result: string[] = []
  const seg = getSegmenter()
  for (const { segment, isWordLike } of seg.segment(text)) {
    const token = segment.trim().toLowerCase()
    if (!token) continue
    if (!isWordLike) {
      // 非词级（标点/空格）跳过，但英文/数字需要单独处理
      // 英文/数字按空白切分
      const subTokens = segment.split(/[\s\p{P}]+/u).filter(Boolean)
      for (const sub of subTokens) {
        const t = sub.toLowerCase()
        if (t && !STOP_WORDS.has(t) && t.length > 0) {
          result.push(t)
        }
      }
      continue
    }
    if (STOP_WORDS.has(token)) continue
    if (token.length < 1) continue
    result.push(token)
  }
  // 去重
  return [...new Set(result)]
}
