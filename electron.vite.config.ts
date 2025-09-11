import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { bytecodePlugin, defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { glob } from 'glob'
import license from 'rollup-plugin-license'
import { cjsInterop } from 'vite-plugin-cjs-interop'

const electronUnzipPlugin = () => {
  return {
    name: 'electron-unzip',
    buildStart () {
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
          console.warn(`Bytecode unsuppored platform: ${process.platform}`)
          return
      }

      try {
        const zipFile = glob.sync(zipPattern, { cwd: electronDistPath })[0]

        if (!zipFile) {
          console.warn(`No electron distribution zip file found for pattern: ${zipPattern}`)
          return
        }

        const zipPath = resolve(electronDistPath, zipFile)
        const extractDir = resolve(electronDistPath, zipFile.replace('.zip', ''))

        process.env.ELECTRON_EXEC_PATH = extractDir + (process.platform === 'win32' ? '/electron.exe' : '/electron')

        if (existsSync(extractDir)) {
          console.log(`Electron distribution already extracted: ${extractDir}`)
          return
        }

        console.log(`Extracting electron distribution: ${zipFile}`)

        mkdirSync(extractDir, { recursive: true })

        if (process.platform === 'win32') {
          execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`)
        } else {
          execSync(`unzip -q "${zipPath}" -d "${extractDir}"`)
        }

        console.log(`Successfully extracted: ${zipFile}`)
      } catch (error) {
        console.error('Failed to extract electron distribution:', error)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [
      electronUnzipPlugin(),
      process.platform !== 'darwin' && bytecodePlugin({ transformArrowFunctions: false }),
      externalizeDepsPlugin(),
      cjsInterop({ dependencies: ['@paymoapp/electron-shutdown-handler'] }),
      license({
        thirdParty: {
          allow: '(MIT OR Apache-2.0 OR ISC OR BSD-3-Clause OR BSD-2-Clause)',
          output: resolve(__dirname, './out/main/LICENSE.txt'),
          includeSelf: true
        }
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
      externalizeDepsPlugin(),
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
