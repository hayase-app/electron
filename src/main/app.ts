import { join } from 'node:path'
import process from 'node:process'

import { electronApp, is } from '@electron-toolkit/utils'
import electronShutdownHandler from '@paymoapp/electron-shutdown-handler'
import { expose } from 'abslink/electron'
import { BrowserWindow, MessageChannelMain, app, dialog, ipcMain, powerMonitor, shell, utilityProcess, Tray, Menu, protocol, nativeImage, session } from 'electron' // type NativeImage, Notification, nativeImage,
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'

import ico from '../../build/icon.ico?asset'
import icon from '../../build/icon.png?asset'

import './util.ts'
import forkPath from './background/background.ts?modulePath'
import Discord from './discord.ts'
// import Protocol from './protocol.ts'
import IPC from './ipc.ts'
import Protocol from './protocol.ts'
import store from './store.ts'
import Updater from './updater.ts'

log.initialize({ spyRendererConsole: true })
log.transports.file.level = 'debug'
log.transports.file.maxSize = 10 * 1024 * 1024 // 10MB
autoUpdater.logger = log

const TRANSPARENCY = store.get('transparency')

const BASE_URL = is.dev ? 'http://localhost:7344/' : 'https://hayase.app/'

protocol.registerSchemesAsPrivileged([
  { scheme: 'https', privileges: { standard: true, bypassCSP: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: false, stream: true, codeCache: true, secure: true } }
])
export default class App {
  torrentProcess = utilityProcess.fork(forkPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'Hayase Torrent Client'
  })

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    frame: false, // process.platform === 'darwin', // Only keep the native frame on Mac
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    transparent: TRANSPARENCY,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    show: false,
    title: 'Hayase',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: true,
      enableBlinkFeatures: 'FontAccess, AudioVideoTracks, FluentOverlayScrollbar, WindowsScrollingPersonality',
      backgroundThrottling: true
    }
  })

  protocol = new Protocol(this.mainWindow)
  updater = new Updater()
  discord = new Discord()
  ipc = new IPC(this, this.torrentProcess, this.discord)
  tray = new Tray(process.platform === 'win32' ? ico : process.platform === 'darwin' ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : icon)

  constructor () {
    expose(this.ipc, ipcMain, this.mainWindow.webContents)
    this.mainWindow.setMenuBarVisibility(false)
    this.mainWindow.webContents.setWindowOpenHandler(e => {
      if (e.url.startsWith('https://anilist.co/api/v2/oauth/authorize')) {
        return {
          action: 'allow',
          createWindow (options) {
            const win = new BrowserWindow({ ...options, resizable: false, fullscreenable: false, title: 'AniList', titleBarOverlay: { color: '#0b1622' }, titleBarStyle: 'hidden', backgroundColor: '#0b1622' })
            win.setMenuBarVisibility(false)
            win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
            return win.webContents
          }
        }
      }
      return { action: 'deny' }
    })
    this.torrentProcess.stderr?.on('data', d => log.error('' + d))
    this.torrentProcess.stdout?.on('data', d => log.log('' + d))
    if (TRANSPARENCY) {
    // Transparency fixes, window is resizable when fullscreen/maximized
      this.mainWindow.on('enter-html-full-screen', () => {
        this.mainWindow.setResizable(false)
      })
      this.mainWindow.on('leave-html-full-screen', () => {
        this.mainWindow.setResizable(!this.mainWindow.isMaximized())
      })
      this.mainWindow.on('enter-full-screen', () => {
        this.mainWindow.setResizable(false)
      })
      this.mainWindow.on('leave-full-screen', () => {
        this.mainWindow.setResizable(!this.mainWindow.isMaximized())
      })
      this.mainWindow.on('maximize', () => {
        this.mainWindow.setResizable(false)
      })
      this.mainWindow.on('unmaximize', () => {
        this.mainWindow.setResizable(true)
      })

      this.mainWindow.on('will-move', (e) => {
        if (this.mainWindow.isMaximized()) {
          this.mainWindow.setResizable(true)
          this.mainWindow.unmaximize()
          e.preventDefault()
        }
      })
    }

    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (details.url.startsWith('https://graphql.anilist.co')) {
        details.requestHeaders.Referer = 'https://anilist.co/'
        details.requestHeaders.Origin = 'https://anilist.co'
        delete details.requestHeaders['User-Agent']
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders })
    })

    // anilist.... forgot to set the cache header on their preflights..... pathetic.... this just wastes rate limits, this fixes it!
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.url.startsWith('https://graphql.anilist.co') && details.method === 'OPTIONS') {
        if (details.responseHeaders) {
          details.responseHeaders['Cache-Control'] = ['public, max-age=86400']
          details.responseHeaders['access-control-max-age'] = ['86400']
        }
      }

      callback({ responseHeaders: details.responseHeaders })
    })

    this.tray.setToolTip('Hayase')
    // this needs to be way better lol
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Hayase', enabled: false },
      { type: 'separator' },
      {
        label: 'Show App',
        click: () => {
          this.mainWindow.show()
          this.mainWindow.focus()
        }
      },
      { type: 'separator' },
      { label: 'Exit Hayase', click: () => this.destroy() }
    ]))
    this.tray.on('click', () => {
      this.mainWindow.show()
      this.mainWindow.focus()
    })

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show()
    })

    this.mainWindow.on('closed', () => this.destroy())
    this.torrentProcess.on('exit', () => this.destroy())
    ipcMain.on('close', () => this.destroy())
    app.on('before-quit', e => {
      if (this.destroyed) return
      e.preventDefault()
      this.destroy()
    })

    this.mainWindow.webContents.on('frame-created', (_, { frame }) => {
      frame.once('dom-ready', () => {
        if (frame.url.startsWith('https://www.youtube-nocookie.com')) {
          frame.executeJavaScript(/* js */`
            new MutationObserver(() => {
              if (document.querySelector('div.ytp-error-content-wrap-subreason a[href*="www.youtube"]')) location.reload()
            }).observe(document.body, { childList: true, subtree: true })
          `)
        }
      })
    })

    powerMonitor.on('shutdown', (e: Event) => {
      if (this.destroyed) return
      e.preventDefault()
      this.destroy()
    })

    // TODO
    // ipcMain.on('notification', async (_e, opts: { icon?: string | NativeImage, data: { id?: number }}) => {
    //   if (opts.icon != null) {
    //     const res = await fetch(opts.icon as string)
    //     const buffer = await res.arrayBuffer()
    //     opts.icon = nativeImage.createFromBuffer(Buffer.from(buffer))
    //   }
    //   const notification = new Notification(opts)
    //   notification.on('click', () => {
    //     if (opts.data.id != null) {
    //       this.mainWindow.show()
    //       this.protocol.protocolMap.anime(',' + opts.data.id)
    //     }
    //   })
    //   notification.show()
    // })

    electronApp.setAppUserModelId('com.github.hayase-app')
    if (process.platform === 'win32') {
      // this message usually fires in dev-mode from the parent process
      process.on('message', data => {
        if (data === 'graceful-exit') this.destroy()
      })
      electronShutdownHandler.setWindowHandle(this.mainWindow.getNativeWindowHandle())
      electronShutdownHandler.blockShutdown('Saving torrent data...')
      electronShutdownHandler.on('shutdown', async () => {
        await this.destroy()
        electronShutdownHandler.releaseShutdown()
      })
    } else {
      process.on('SIGTERM', () => this.destroy())
    }

    if (is.dev) this.mainWindow.webContents.openDevTools()
    this.mainWindow.loadURL(BASE_URL + this.protocol.navigateTarget())
    this.mainWindow.webContents.on('will-navigate', (e, url) => {
      const parsedUrl = new URL(url)
      if (parsedUrl.origin !== BASE_URL) {
        e.preventDefault()
      }
    })

    let crashcount = 0
    this.mainWindow.webContents.on('render-process-gone', async (_e, { reason }) => {
      if (reason === 'crashed') {
        if (++crashcount > 10) {
          // TODO
          await dialog.showMessageBox({ message: 'Crashed too many times.', title: 'Hayase', detail: 'App crashed too many times. For a fix visit https://hayase.watch/faq/', icon })
          shell.openExternal('https://hayase.watch/faq/')
        } else {
          app.relaunch()
        }
        app.quit()
      }
    })

    const reloadPorts = () => {
      if (this.destroyed) return
      const { port1, port2 } = new MessageChannelMain()
      this.torrentProcess.postMessage({ id: 'settings', data: { ...store.data.torrentSettings, path: store.data.torrentPath, player: store.data.player } }, [port1])

      this.mainWindow.webContents.postMessage('port', null, [port2])
    }

    const { port1, port2 } = new MessageChannelMain()
    this.torrentProcess.once('spawn', () => this.torrentProcess.postMessage({ id: 'settings', data: { ...store.data.torrentSettings, path: store.data.torrentPath, player: store.data.player } }, [port1]))
    ipcMain.once('preload-done', () => {
      this.mainWindow.webContents.postMessage('port', null, [port2])
      ipcMain.on('preload-done', () => reloadPorts())
    })

    app.on('second-instance', (_event, commandLine) => {
      if (this.destroyed) return
      // Someone tried to run a second instance, we should focus our window.
      this.mainWindow.show()
      this.mainWindow.focus()
      if (this.mainWindow.isMinimized()) this.mainWindow.restore()
      this.mainWindow.focus()
      // There's probably a better way to do this instead of a for loop and split[1][0]
      // but for now it works as a way to fix multiple OS's commandLine differences
      for (const line of commandLine) {
        this.protocol.handleProtocol(line)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    app.setJumpList?.([
      {
        type: 'custom',
        name: 'Frequent',
        items: [
          {
            type: 'task',
            program: 'hayase://schedule/',
            title: 'Airing Schedule',
            description: 'Open The Airing Schedule'
          },
          {
            type: 'task',
            program: 'hayase://w2g/',
            title: 'Watch Together',
            description: 'Create a New Watch Together Lobby'
          },
          {
            type: 'task',
            program: 'hayase://donate/',
            title: 'Donate',
            description: 'Support This App'
          }
        ]
      }
    ])
  }

  destroyed = false

  hideToTray () {
    if (this.destroyed) return
    this.mainWindow.hide()
  }

  async destroy (forceRunAfter = false) {
    if (this.destroyed) return
    this.destroyed = true
    this.mainWindow.hide()
    this.torrentProcess.postMessage({ id: 'destroy' })
    await new Promise(resolve => {
      this.torrentProcess.once('exit', resolve)
      setTimeout(resolve, 5000).unref()
    })
    if (!this.updater.install(forceRunAfter)) app.quit()
  }
}
