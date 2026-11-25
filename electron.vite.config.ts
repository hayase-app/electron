import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { defineConfig } from 'electron-vite'
import { glob } from 'glob'
import license from 'rollup-plugin-license'

import type { Plugin } from 'vite'

const NATIVE_ADDON_PREFIX = '\0native-addon:'

// Bundle all JS of the packages. Replace their addon loader (node-gyp-build or require-addon) with a module
// that requires the prebuilt .node file. electron-vite emits each .node file as an asset next to the chunks.
const nativeAddonPlugin = ({ dependencies }: { dependencies: string[] }): Plugin => {
  // The mac build is universal, so it must ship both architectures.
  const arches = process.platform === 'darwin' ? ['x64', 'arm64'] : [process.arch]

  const findPackageDir = (id: string) => {
    for (const pkg of dependencies) {
      const marker = `/node_modules/${pkg}/`
      const index = id.lastIndexOf(marker)
      if (index !== -1) return id.slice(0, index + marker.length)
    }
    return null
  }

  return {
    name: 'native-addon',
    enforce: 'pre',
    transform (code, id) {
      if (!findPackageDir(id)) return null
      // Rolldown does not follow createRequire(import.meta.url). Without this, the loader stays a runtime require.
      const newCode = code.replace(/\bcreateRequire\(\s*import\.meta\.url\s*\)/g, 'require')
      return newCode === code ? null : { code: newCode, map: null }
    },
    resolveId (source, importer) {
      if (source !== 'node-gyp-build' && source !== 'require-addon') return null
      const packageDir = importer && findPackageDir(importer)
      return packageDir ? NATIVE_ADDON_PREFIX + packageDir : null
    },
    load (id) {
      if (!id.startsWith(NATIVE_ADDON_PREFIX)) return null
      const packageDir = id.slice(NATIVE_ADDON_PREFIX.length)
      const paths = arches.flatMap(arch => {
        const prebuildDir = `${packageDir}prebuilds/${process.platform}-${arch}`
        const file = existsSync(prebuildDir) && readdirSync(prebuildDir).find(name => name.endsWith('.node'))
        return file ? [`${JSON.stringify(arch)}: require(${JSON.stringify(`${prebuildDir}/${file}?asset`)}).default`] : []
      })
      return `const paths = { ${paths.join(', ')} }\nmodule.exports = () => require(paths[process.arch])\n`
    }
  }
}

// electron-vite starts the bytecode compiler before any plugin hook runs
const extractElectronDistribution = () => {
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
    const electronBinary = resolve(extractDir, process.platform === 'win32' ? 'electron.exe' : 'electron')

    process.env.ELECTRON_EXEC_PATH = electronBinary

    // Check the binary. An interrupted run can leave an empty directory.
    if (existsSync(electronBinary)) {
      console.log(`\nElectron distribution already extracted: ${extractDir}`)
      return
    }

    console.log(`\nExtracting electron distribution: ${zipFile}`)

    mkdirSync(extractDir, { recursive: true })

    if (process.platform === 'win32') {
      // Expand-Archive in PowerShell 7.6 fails on .NET 10 with
      // "Cannot find an overload for ExtractToDirectory". Use the bsdtar that Windows ships.
      const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      execSync(`"${tar}" -xf "${zipPath}" -C "${extractDir}"`)
    } else {
      execSync(`unzip -q "${zipPath}" -d "${extractDir}"`)
      execSync(`chmod +x "${electronBinary}"`)
    }

    if (!existsSync(electronBinary)) {
      throw new Error(`Extraction did not create ${electronBinary}`)
    }

    console.log(`\nSuccessfully extracted: ${zipFile}`)
  } catch (error) {
    console.error('\nFailed to extract electron distribution:', error)
    throw error
  }
}

extractElectronDistribution()

export default defineConfig({
  main: {
    build: {
      bytecode: process.platform !== 'darwin' && { transformArrowFunctions: false }
    },
    plugins: [
      license({
        thirdParty: {
          allow: '(MIT OR Apache-2.0 OR ISC OR BSD-3-Clause OR BSD-2-Clause)',
          output: resolve(__dirname, './out/main/LICENSE.txt'),
          includeSelf: true
        }
      }),
      nativeAddonPlugin({
        dependencies: [
          '@paymoapp/electron-shutdown-handler',
          '@thaunknown/yencode',
          '@thaunknown/utp-native',
          'fs-native-extensions'
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
