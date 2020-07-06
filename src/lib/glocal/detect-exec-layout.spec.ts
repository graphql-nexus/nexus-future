import * as os from 'os'
import * as path from 'path'
import * as TestContext from '../test-context'
import { normalizePathsInData, Param1 } from '../utils'
import { detectExecLayout } from './detect-exec-layout'

const ctx = TestContext.compose(TestContext.tmpDir(), TestContext.fs(), (ctx) => {
  return {
    detectExecLayout: (input?: Partial<Param1<typeof detectExecLayout>>) => {
      const v = detectExecLayout({
        depName: 'a',
        cwd: ctx.tmpDir,
        scriptPath: ctx.fs.path('some/other/bin/a'),
        ...input,
      })
      console.log('%j %j', ctx.tmpDir, v)
      return normalizePathsInData(v, ctx.tmpDir, '/__dynamic__')
    },
  }
})

function nodeProject() {
  ctx.fs.write('package.json', '{}')
}
function installTool() {
  ctx.fs.write(
    'package.json',
    JSON.stringify({
      dependencies: { a: 'foo' },
    })
  )
  ctx.fs.write('node_modules/a/index.js', '')
  ctx.fs.write(
    'node_modules/a/package.json',
    JSON.stringify({
      name: 'a',
      bin: {
        a: 'index.js',
      },
    })
  )
  if (os.platform() === 'win32') {
    ctx.fs.write('node_modules/.bin/a', '')
  } else {
    ctx.fs.symlink(ctx.fs.path('node_modules/a/index.js'), 'node_modules/.bin/a')
  }
}

beforeEach(() => {
  ctx.fs.dir('some/other/bin/a')
  ctx.fs.dir('node_modules/.bin')
})

describe('node project detection', () => {
  it('if package.json is present then is a node project', () => {
    ctx.fs.write('package.json', '{}')
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: true,
      toolProject: false,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
  it('if package.json is present in ancestor dir then is a node project', () => {
    ctx.fs.write('package.json', '{}')
    expect(ctx.detectExecLayout({ cwd: path.join(ctx.tmpDir, 'a', 'b', 'c') })).toMatchObject({
      nodeProject: true,
      toolProject: false,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
  it('if package.json not present then is not a node project', () => {
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: false,
      toolProject: false,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
})

describe('tool project detection', () => {
  beforeEach(() => {
    ctx.fs.write('package.json', '{}')
  })
  it('if tool not listed as package dep then project not considered of that tool', () => {
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: true,
      toolProject: false,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
  it('if tool listed as package dep then project considered of that tool', () => {
    ctx.fs.write('package.json', '{ "dependencies": { "a": "foo" } }')
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: true,
      toolProject: true,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
})

describe('local available detection', () => {
  beforeEach(installTool)
  it('if tool in deps and installed in node_modules and symlinked in local bin, then considered available', () => {
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: true,
      toolProject: true,
      toolCurrentlyPresentInNodeModules: true,
      runningLocalTool: false,
    })
  })
  it('if just bin missing, discounts being available', () => {
    ctx.fs.remove('node_modules/.bin/a')
    expect(ctx.detectExecLayout()).toMatchObject({
      nodeProject: true,
      toolProject: true,
      toolCurrentlyPresentInNodeModules: false,
      runningLocalTool: false,
    })
  })
  //  it('if just node_module/dir missing, discounts being available', () => {
  //    ctx.fs.remove('node_modules/a')
  //    expect(ctx.detectExecLayout()).toMatchObject({
  //      nodeProject: true,
  //     toolProject: true,
  //      toolCurrentlyPresentInNodeModules: false,
  //      runningLocalTool: false,
  //    })
  //  })
})

describe('running locally detection', () => {
  beforeEach(installTool)
  it('if process script path matches path to tool in project bin then considered running locally', () => {
    expect(ctx.detectExecLayout({ scriptPath: ctx.fs.path('node_modules/a/index.js') })).toMatchObject({
      nodeProject: true,
      toolProject: true,
      toolCurrentlyPresentInNodeModules: true,
      runningLocalTool: true,
    })
  })
  it('if process script path does not match path to tool in project bin then not considered running locally', () => {
    expect(ctx.detectExecLayout({ scriptPath: ctx.fs.path('some/other/bin/a') })).toMatchObject({
      nodeProject: true,
      toolProject: true,
      toolCurrentlyPresentInNodeModules: true,
      runningLocalTool: false,
    })
  })
})

describe('this process analysis', () => {
  beforeEach(() => {
    ctx.fs.write('a/b/c/real.js', '')
    if (os.platform() === 'win32') {
      ctx.fs.write('x/y/z/fake', '')
    } else {
      ctx.fs.symlink(ctx.fs.path('a/b/c/real.js'), 'x/y/z/fake')
    }
  })
  it('finds the real path of the script node executed', () => {
    const data = ctx.detectExecLayout({ scriptPath: ctx.fs.path('x/y/z/fake') })

    if (os.platform() === 'win32') {
      expect(data.thisProcessScriptPath).toMatchInlineSnapshot(`"/__dynamic__/x/y/z/fake"`)
    } else {
      expect(data.thisProcessScriptPath).toMatchInlineSnapshot(`"/__dynamic__/a/b/c/real.js"`)
    }
  })

  it('supports node running script without extension', () => {
    const data = ctx.detectExecLayout({ scriptPath: ctx.fs.path('a/b/c/real') })
    expect(data.thisProcessScriptPath).toMatchInlineSnapshot(`"/__dynamic__/a/b/c/real.js"`)
  })
})

describe('project analysis', () => {
  it('null if not a node project', () => {
    const data = ctx.detectExecLayout()
    expect(data.nodeProject).toEqual(false)
    expect(data.project).toEqual(null)
  })
  it('info if a node project', () => {
    nodeProject()
    const data = ctx.detectExecLayout()
    expect(data.nodeProject).toEqual(true)
    // expect(data.project).toMatchInlineSnapshot(`
    //   Object {
    //     "binDir": "/__dynamic__/node_modules/.bin",
    //     "dir": "/__dynamic__",
    //     "nodeModulesDir": "/__dynamic__/node_modules",
    //     "toolBinPath": "/__dynamic__/node_modules/.bin/a",
    //     "toolBinRealPath": null,
    //   }
    // `)
    expect(data.project).toMatchInlineSnapshot(`
      Object {
        "dir": "/__dynamic__",
        "nodeModulesDir": "/__dynamic__/node_modules",
        "toolPath": null,
      }
    `)
  })
  it.only('finds real path of local bin if present', () => {
    installTool()
    const data = ctx.detectExecLayout()
    expect(data.toolProject).toEqual(true)
    expect(data.project).toMatchInlineSnapshot(`
    Object {
      "dir": "/__dynamic__",
      "nodeModulesDir": "/__dynamic__/node_modules",
      "toolPath": "/__dynamic__/node_modules/a/index.js",
    }
  `)
  })
})
