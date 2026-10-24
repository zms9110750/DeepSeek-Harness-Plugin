// 切换前冒烟测试：真的把插件模块 import 进来，确认没有导入期错误。
// 只加载模块、不 apply()，因此不会碰数据库、不会装门面、不会建子 agent。
const target = process.argv[2]

const t0 = Date.now()
const mod = await import(target)
const ms = Date.now() - t0

const names = Object.keys(mod).sort()
const hasApply = typeof mod.apply === 'function'
const hasName = typeof mod.name === 'string'
const inject = Array.isArray(mod.inject) ? mod.inject : null

console.log(`导入成功，用时 ${ms}ms`)
console.log(`导出的符号: ${names.join(', ')}`)
console.log(`name   = ${JSON.stringify(mod.name)}`)
console.log(`apply  = ${hasApply ? 'function ✓' : '缺失 ✗'}`)
console.log(`inject = ${JSON.stringify(inject)}`)

const ok = hasApply && hasName
console.log(ok ? '\n冒烟测试通过' : '\n冒烟测试失败')
process.exit(ok ? 0 : 1)
