import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { defineConfig } from 'electron-vite'
import { glob } from 'glob'
import license from 'rollup-plugin-license'
import { cjsInterop } from 'vite-plugin-cjs-interop'

import type { Plugin } from 'vite'

const pkgName = (pkg: string) => pkg.replace(/@/g, '').replace(/\//g, '-')

const nativeModuleDir = (pkg: string) => `native-modules/${pkgName(pkg)}`

function copyDirRecursive (src: string, dst: string) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const dstPath = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath)
    } else {
      copyFileSync(srcPath, dstPath)
    }
  }
}

const compileNativeModulesPlugin = ({ dependencies: NATIVE_PACKAGES }: { dependencies: string[] }): Plugin => {
  let outDir: string
  let projectRoot: string

  // Static .node require to emit to native-assets/
  const staticAssets = new Map<string, { src: string, dst: string }>()
  let assetCounter = 0

  // Dynamic packages (node-gyp-build / require-addon) to copy prebuilds + package.json to native-modules/
  const pendingModules = new Map<string, { pkgDir: string, moduleDir: string }>()

  return {
    name: 'vite:fix-native-module-dirs',
    enforce: 'pre',
    configResolved (config) {
      outDir = resolve(config.build.outDir)
      projectRoot = config.root
    },
    transform (code, id) {
      const matchedPkg = NATIVE_PACKAGES.find(pkg => id.includes(`/node_modules/${pkg}/`))
      if (!matchedPkg) return null

      const hasDirRefs = code.includes('__dirname') || code.includes('__filename')
      const hasNodeRequire = /require\s*\(\s*['"`]((?:\.\.?\/).*?\.node)['"`]\s*\)/.test(code)

      if (!hasDirRefs && !hasNodeRequire) return null

      // Find the package-relative part of the file path
      const pkgMarker = `/node_modules/${matchedPkg}/`
      const pkgIdx = id.lastIndexOf(pkgMarker)
      const withinPkg = pkgIdx !== -1 ? id.substring(pkgIdx + pkgMarker.length) : basename(id)

      let newCode = code

      // Static require('../path/to/file.node') → emit to native-assets/
      if (hasNodeRequire) {
        newCode = newCode.replace(
          /require\s*\(\s*(['"`])((?:\.\.?\/).*?\.node)\1\s*\)/g,
          (_match, _quote, filePath) => {
            const absolutePath = resolve(dirname(id), filePath)
            const assetName = `${pkgName(matchedPkg)}-${basename(absolutePath)}`
            const dstRel = `native-assets/${assetCounter++}-${assetName}`
            const dst = resolve(outDir, dstRel)
            staticAssets.set(dstRel, { src: absolutePath, dst })
            return `require(__dirname + "/${dstRel}")`
          }
        )
      }

      // Dynamic loading (node-gyp-build / require-addon) to point __dirname/__filename to native-modules/
      if (hasDirRefs) {
        const modulesDir = nativeModuleDir(matchedPkg)
        const withinDir = dirname(withinPkg)
        const relModulePath = withinDir !== '.' ? `${modulesDir}/${withinDir}` : modulesDir

        // Schedule prebuilds + package.json for this package (only once)
        if (!pendingModules.has(matchedPkg)) {
          pendingModules.set(matchedPkg, {
            pkgDir: resolve(projectRoot, 'node_modules', matchedPkg),
            moduleDir: resolve(outDir, modulesDir)
          })
        }

        newCode = newCode
          .replace(/\b__dirname\b(?!\s*:)/g, `__dirname + "/${relModulePath}"`)
          .replace(/\b__filename\b(?!\s*:)/g, `__dirname + "/${relModulePath}/${basename(id)}"`)
      }

      if (newCode === code) return null

      return { code: newCode, map: null }
    },
    writeBundle () {
      // Copy static .node assets
      for (const [, { src, dst }] of staticAssets) {
        try {
          const dstDir = dirname(dst)
          if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true })
          copyFileSync(src, dst)
          console.log(`[native-assets] Copied ${src} -> ${dst}`)
        } catch (err) {
          console.error(`[native-assets] Failed to copy ${src}: `, err)
        }
      }
      staticAssets.clear()
      assetCounter = 0

      // Copy dynamic package support files (prebuilds + package.json) to native-modules/
      for (const { pkgDir, moduleDir } of pendingModules.values()) {
        try {
          // Copy package.json (needed by require-addon / node-gyp-build for NAME_PREBUILD)
          const pkgJson = join(pkgDir, 'package.json')
          if (existsSync(pkgJson)) {
            if (!existsSync(moduleDir)) mkdirSync(moduleDir, { recursive: true })
            copyFileSync(pkgJson, join(moduleDir, 'package.json'))
          }

          // Copy all platform prebuilds (electron-builder filters at package time)
          const prebuildsSrc = join(pkgDir, 'prebuilds')
          if (existsSync(prebuildsSrc)) {
            const prebuildsDst = join(moduleDir, 'prebuilds')
            copyDirRecursive(prebuildsSrc, prebuildsDst)
            console.log(`[native-modules] Copied prebuilds for ${basename(moduleDir)}`)
          }
        } catch (err) {
          console.error(`[native-modules] Failed to setup ${pkgDir}: `, err)
        }
      }
      pendingModules.clear()
    }
  }
}

const electronUnzipPlugin = () => {
  return {
    name: 'electron-unzip',
    buildStart () {
      // skip on dev
      // if (process.env.NODE_ENV === 'development') return
      const electronDistPath = resolve(__dirname, 'electron-dist')

      let zipPattern: string
      switch (process.platform) {
        case 'win32':
          zipPattern = '*win32*.zip'
          break
        case 'freebsd':
        case 'openbsd':
        case 'linux':
          zipPattern = '*linux*.zip'
          break
        default:
          console.warn(`\nBytecode unsuppored platform: ${process.platform}`)
          return
      }

      try {
        const zipFile = glob.sync(zipPattern, { cwd: electronDistPath })[0]

        if (!zipFile) {
          console.warn(`\nNo electron distribution zip file found for pattern: ${zipPattern}`)
          return
        }

        const zipPath = resolve(electronDistPath, zipFile)
        const extractDir = resolve(electronDistPath, zipFile.replace('.zip', ''))

        process.env.ELECTRON_EXEC_PATH = extractDir + (process.platform === 'win32' ? '/electron.exe' : '/electron')

        if (existsSync(extractDir)) {
          console.log(`\nElectron distribution already extracted: ${extractDir}`)
          return
        }

        console.log(`\nExtracting electron distribution: ${zipFile}`)

        mkdirSync(extractDir, { recursive: true })

        if (process.platform === 'win32') {
          execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`)
        } else {
          execSync(`unzip -q "${zipPath}" -d "${extractDir}"`)
          const electronBinary = resolve(extractDir, 'electron')
          execSync(`chmod +x "${electronBinary}"`)
        }

        console.log(`\nSuccessfully extracted: ${zipFile}`)
      } catch (error) {
        console.error('\nFailed to extract electron distribution:', error)
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      bytecode: process.platform !== 'darwin' && { transformArrowFunctions: false },
      commonjsOptions: {
        ignore: (id: string) => id.endsWith('.node'),
        ignoreDynamicRequires: true
      }
    },
    plugins: [
      electronUnzipPlugin(),
      cjsInterop({ dependencies: ['@paymoapp/electron-shutdown-handler'] }),
      license({
        thirdParty: {
          allow: '(MIT OR Apache-2.0 OR ISC OR BSD-3-Clause OR BSD-2-Clause)',
          output: resolve(__dirname, './out/main/LICENSE.txt'),
          includeSelf: true
        }
      }),
      compileNativeModulesPlugin({
        dependencies: [
          '@paymoapp/electron-shutdown-handler',
          '@thaunknown/yencode',
          'fs-native-extensions',
          'utp-native'
        ]
      })
    ],
    resolve: {
      alias: {
        'http-tracker': resolve(__dirname, 'node_modules/bittorrent-tracker/lib/client/http-tracker.js'),
        'webrtc-polyfill': resolve(__dirname, 'src/main/patches/module.cjs'),
        ws: resolve(__dirname, 'src/main/patches/ws.cjs'),
        '@discordjs/rest': resolve(__dirname, 'src/main/patches/rest.cjs'),
        './transport/WebSocket': resolve(__dirname, 'src/main/patches/module.cjs'),
        './structures/ClientUser': resolve(__dirname, 'src/main/patches/user.cjs'),
        'discord-api-types/v10': resolve(__dirname, 'src/main/patches/module.cjs'),
        debug: resolve(__dirname, 'src/main/patches/debug.cjs')
      }
    }
  },
  preload: {
    // preload is too small for bytecodePlugin to be effective
    plugins: [
      license({
        thirdParty: {
          allow: '(MIT OR Apache-2.0 OR ISC OR BSD-3-Clause OR BSD-2-Clause)',
          output: resolve(__dirname, './out/preload/LICENSE.txt'),
          includeSelf: true
        }
      })
    ]
  }
})
