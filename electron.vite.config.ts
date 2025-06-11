import { bytecodePlugin, defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { cjsInterop } from 'vite-plugin-cjs-interop'
import license from 'rollup-plugin-license'

export default defineConfig({
  main: {
    plugins: [
      // bytecodePlugin({ transformArrowFunctions: false }),
      externalizeDepsPlugin(),
      cjsInterop({ dependencies: ['@paymoapp/electron-shutdown-handler']}),
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
        'ws': resolve(__dirname, 'src/main/patches/ws.cjs'),
        "@discordjs/rest": resolve(__dirname, 'src/main/patches/rest.cjs'),
        './transport/WebSocket': resolve(__dirname, 'src/main/patches/module.cjs'),
        './structures/ClientUser': resolve(__dirname, 'src/main/patches/user.cjs'),
        'discord-api-types/v10': resolve(__dirname, 'src/main/patches/module.cjs'),
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
