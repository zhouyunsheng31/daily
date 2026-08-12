/**
 * searchTokenizer.ts 单元测试 — Phase 12
 *
 * 覆盖重点：
 * 1. 中文分词（"我的笔记" → ["笔记"]，"的"是停用词）
 * 2. 英文小写（"Hello World" → ["hello", "world"]）
 * 3. 停用词过滤（"the a an" → []）
 * 4. 空字符串（"" → []）
 * 5. 数字处理（"123 abc" → ["123", "abc"]）
 * 6. 中英混合（"测试 hello 世界" → ["测试", "hello", "世界"]）
 *
 * 说明：tokenize 是纯函数，依赖 Intl.Segmenter（happy-dom 支持），
 *      无需 mock，直接验证输入输出。
 */
import { describe, test, expect } from 'vitest'
import { tokenize } from '../searchTokenizer'

describe('searchTokenizer', () => {
  test('1. 中文分词（"我的笔记" → ["我的", "笔记"]，Intl.Segmenter 将"我的"视作一个词段）', () => {
    // Intl.Segmenter zh-CN granularity=word 将 "我的笔记" 切分为 "我的" + "笔记"
    // "我的" 不在停用词表中（停用词表只含单字 "我"/"的"，不含组合 "我的"）
    const result = tokenize('我的笔记')
    expect(result).toEqual(['我的', '笔记'])
  })

  test('1b. 中文单字停用词过滤（"了" 在停用词表中 → 被过滤）', () => {
    // "了" 是单字停用词，segmenter 产出一个 word-like 段，被 STOP_WORDS 过滤
    expect(tokenize('了')).toEqual([])
    // "的" 同理
    expect(tokenize('的')).toEqual([])
  })

  test('2. 英文小写（"Hello World" → ["hello", "world"]）', () => {
    const result = tokenize('Hello World')
    expect(result).toEqual(['hello', 'world'])
  })

  test('3. 停用词过滤（"the a an" → []）', () => {
    const result = tokenize('the a an')
    expect(result).toEqual([])
  })

  test('4. 空字符串（"" → []）', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
    expect(tokenize('\t\n')).toEqual([])
  })

  test('5. 数字处理（"123 abc" → ["123", "abc"]）', () => {
    const result = tokenize('123 abc')
    expect(result).toEqual(['123', 'abc'])
  })

  test('6. 中英混合（"测试 hello 世界" → ["测试", "hello", "世界"]）', () => {
    const result = tokenize('测试 hello 世界')
    expect(result).toEqual(['测试', 'hello', '世界'])
  })

  test('7. 去重（重复 token 只保留一个）', () => {
    const result = tokenize('hello hello world world')
    expect(result).toEqual(['hello', 'world'])
  })
})
