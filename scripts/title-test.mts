// 标题生成链路排障：在服务器上复现 generateConversationTitle 用的 completeSimple
import 'dotenv/config'
import { join } from 'path'
import { AuthStorage, getAgentDir, ModelRegistry } from '@earendil-works/pi-coding-agent'
import { completeSimple } from '@earendil-works/pi-ai'

const registerDeepseek = (registry: { registerProvider(name: string, config: unknown): void }, apiKey: string, baseUrl: string | undefined): void => {
  const effectiveBaseUrl = baseUrl?.trim() || 'https://api.deepseek.com'
  registry.registerProvider('deepseek', {
    baseUrl: effectiveBaseUrl,
    apiKey,
    models: [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      api: 'openai-completions',
      baseUrl: effectiveBaseUrl,
      compat: { requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek' },
      reasoning: true,
      thinkingLevelMap: { low: 'low', medium: 'medium', high: 'high', xhigh: 'max' },
      input: ['text'],
      cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 384_000,
    }],
  })
}

const main = async (): Promise<void> => {
  const agentDir = getAgentDir()
  console.log('agentDir=', agentDir)
  const authStorage = AuthStorage.create(agentDir ? join(agentDir, 'auth.json') : undefined)
  const key = process.env.DEEPSEEK_API_KEY?.trim()
  console.log('keySet=', Boolean(key))
  if (key) authStorage.setRuntimeApiKey('deepseek', key)

  const registry = ModelRegistry.create(authStorage)
  registerDeepseek(registry, key ?? '', process.env.DEEPSEEK_BASE_URL)
  const model = registry.find('deepseek', 'deepseek-v4-flash')
  console.log('model=', model ? 'FOUND' : 'MISSING')
  console.log('model.cost=', JSON.stringify(model?.cost))
  if (!model) return

  try {
    const r = await completeSimple(model, {
      systemPrompt: '你是会话标题生成器。根据对话内容用中文生成4-15字标题，只输出标题本身。',
      messages: [{ role: 'user', content: '做一个待办清单App', timestamp: Date.now() }],
    }, {
      reasoning: 'minimal',
      maxTokens: 64,
      temperature: 0.3,
    })
    console.log('result=', JSON.stringify(r))
    const textBlock = r.content.find((b: { type: string }) => b.type === 'text') as { text?: string } | undefined
    console.log('title=', textBlock?.text ?? '(empty)')
  } catch (e) {
    console.error('>>> TEST_ERROR >>>', (e as Error)?.message ?? String(e))
    console.error('cause=', JSON.stringify((e as { cause?: unknown })?.cause ?? null))
  }
}

void main()