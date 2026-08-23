// server/src/webos/engines/index.ts —— W4 包执行引擎统一出口
// ----------------------------------------------------------------------------
// 组装：skill（注入用户 skills/）+ theme（design tokens → CSS 变量）+
//       bundle（组合容器闭包聚合）+ pet-layer（桌宠场景）四个引擎。
// 接入方（webos.ts / packages 生命周期 / 单测）只依赖本文件导出的少量符号。
// ============================================================================

export {
  skillEngine,
  installSkillPackage,
  uninstallSkillPackage,
  resolveSkillFiles,
  skillInstallDir,
  type SkillInstallMeta,
  type SkillFileRef,
} from './skill-engine.js'

export {
  themeEngine,
  applyThemeTokens,
  resolveThemeTokens,
  normalizeTokens,
  DEFAULT_TOKENS,
  REQUIRED_TOKEN_KEYS,
  type ThemeTokensResult,
} from './theme-engine.js'

export {
  bundleEngine,
  resolveBundleClosure,
  isBundleDepthValid,
  bundleContentsOf,
  bundleChildrenOf,
  readBundleManifest,
  BUNDLE_MAX_DEPTH,
  type BundleClosureItem,
  type BundleClosureResult,
  type BundleResolver,
  type BundleContentKind,
} from './bundle-engine.js'

export {
  petLayerEngine,
  loadPetLayerScene,
  PET_LAYER_DEFAULT,
  type PetLayerScene,
  type PetLayerBehavior,
} from './pet-layer-engine.js'