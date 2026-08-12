import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const agentDir = getAgentDir()
console.log('agentDir:', agentDir)

if (agentDir) {
  const extDir = join(agentDir, 'extensions')
  console.log('extDir:', extDir)
  if (existsSync(extDir)) {
    const files = readdirSync(extDir)
    console.log('Files in extensions:', files)
    for (const f of files) {
      if (f.includes('stepfun')) {
        const full = join(extDir, f)
        console.log(`\n--- ${full} ---`)
        console.log(readFileSync(full, 'utf-8'))
      }
    }
  } else {
    console.log('extDir does not exist')
  }
} else {
  console.log('agentDir is null')
}
