import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, extname } from 'node:path'

import { app, dialog, shell, type UtilityProcess, ipcMain } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'

import store from './store'

import type App from './app'
import type { SessionMetadata, TorrentSettings } from '../types'
import type Discord from './discord'

const WHITELISTED_URLS = ['https://anilist.co/', 'https://github.com/sponsors/ThaUnknown/', 'https://myanimelist.net/', 'https://miru.watch', 'https://hayase.app', 'https://hayase.watch', 'https://thewiki.moe']

let player: ReturnType<typeof spawn> | undefined

export default class IPC {
  app
  torrentProcess
  hideToTray = false
  discord
  constructor (window: App, torrentProcess: UtilityProcess, discord: Discord) {
    this.app = window
    this.torrentProcess = torrentProcess
    this.discord = discord
    ipcMain.handle('version', () => app.getVersion())
  }

  openURL (url: string) {
    if (!WHITELISTED_URLS.some((whitelisted) => url.startsWith(whitelisted))) return
    shell.openExternal(url)
  }

  minimise () {
    this.app.mainWindow.minimize()
  }

  maximise () {
    this.app.mainWindow.isMaximized() ? this.app.mainWindow.unmaximize() : this.app.mainWindow.maximize()
  }

  close () {
    if (this.hideToTray) {
      this.app.mainWindow.hide()
    } else {
      this.app.destroy()
    }
  }

  setHideToTray (enabled: boolean) {
    this.hideToTray = enabled
  }

  restart () {
    app.relaunch()
    this.app.destroy()
  }

  downloadProgress (percent: number) {
    this.app.mainWindow.setProgressBar((percent === 1 || percent === 0) ? -1 : percent)
  }

  focus () {
    this.app.mainWindow.show()
    if (this.app.mainWindow.isMinimized()) this.app.mainWindow.restore()
    this.app.mainWindow.focus()
  }

  setTransparency (enabled: boolean) {
    store.set('transparency', enabled)
  }

  setZoom (scale: number) {
    this.app.mainWindow.webContents.setZoomFactor(Math.min(2.5, Math.max(Number(scale) || 1, 0.3)))
  }

  async selectPlayer () {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Select video player executable',
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return store.get('player')

    const path = filePaths[0]!

    store.set('player', path)
    return basename(path, extname(path))
  }

  async updateSettings (settings: TorrentSettings) {
    store.set('torrentSettings', settings)

    this.torrentProcess.postMessage({ id: 'settings', data: { ...store.data.torrentSettings, path: store.data.torrentPath, player: store.data.player } })
  }

  async selectDownload () {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Select torrent download location',
      properties: ['openDirectory']
    })
    if (canceled || !filePaths.length) return store.get('torrentPath')

    let path = filePaths[0]!
    if (!(path.endsWith('\\') || path.endsWith('/'))) {
      if (path.includes('\\')) {
        path += '\\'
      } else if (path.includes('/')) {
        path += '/'
      }
    }
    store.set('torrentPath', path)
    return path
  }

  setAngle (angle: string) {
    store.set('angle', angle)
  }

  async getLogs () {
    return await readFile(log.transports.file.getFile().path, 'utf8')
  }

  async getDeviceInfo () {
    const { model, speed } = os.cpus()[0]!
    return {
      features: app.getGPUFeatureStatus(),
      info: await app.getGPUInfo('complete'),
      cpu: { model, speed },
      ram: os.totalmem()
    }
  }

  openUIDevtools () {
    this.app.mainWindow.webContents.openDevTools()
  }

  toggleDiscordDetails (enabled: boolean) {
    this.discord.allowDiscordDetails = enabled
    this.discord.debouncedDiscordRPC()
  }

  setMediaSession (metadata: SessionMetadata, id: number) {
    this.discord.session = metadata
    this.discord.mediaId = id
    this.discord.debouncedDiscordRPC()
  }

  setPositionState (state?: MediaPositionState) {
    this.discord.position = state
    this.discord.debouncedDiscordRPC()
  }

  setPlayBackState (paused: 'none' | 'paused' | 'playing') {
    this.discord.playback = paused
    this.discord.debouncedDiscordRPC()
  }

  setDOH (dns: string) {
    try {
      app.configureHostResolver({
        secureDnsMode: 'secure',
        secureDnsServers: [new URL(dns).toString()]
      })
    } catch (e) {}
  }

  version () {
    app.getVersion()
  }

  updateProgress () {
    autoUpdater.on('download-progress', (progress) => {
      this.app.mainWindow.webContents.send('update-progress', progress.percent)
    })
    autoUpdater.on('update-downloaded', () => {
      this.app.mainWindow.webContents.send('update-progress', 100)
    })
  }

  checkUpdate () {
    autoUpdater.checkForUpdates()
  }

  updateAndRestart () {
    this.app.destroy(true)
  }

  async updateReady () {
    const update = await autoUpdater.checkForUpdates()
    if (!update) throw new Error('No update available')
    await update.downloadPromise
  }

  async spawnPlayer (url: string) {
    if (!url) throw new Error('No URL provided')
    if (!url.startsWith('http://localhost:')) throw new Error('Invalid URL')
    let path = store.get('player')
    if (!path) throw new Error('No player selected')

    if (process.platform === 'darwin' && extname(path) === '.app') {
    // Mac: Use executable in packaged .app bundle
      path += `/Contents/MacOS/${basename(path, '.app')}`
    }

    player?.kill()

    await new Promise((resolve, reject) => {
      const playerProcess = spawn(path, [new URL(url).toString()], { stdio: 'ignore' })
      player = playerProcess
      this.app.mainWindow.focus()
      playerProcess.once('close', resolve)
      playerProcess.once('error', reject)
    })
    // this.dispatch('open', `intent://localhost:${this.server.address().port}${found.streamURL}#Intent;type=video/any;scheme=http;end;`)
  }
}
