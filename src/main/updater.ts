import { env } from 'node:process'

import { autoUpdater } from 'electron-updater'

import Flatpak from './flatpak.ts'

import type { ProgressInfo } from 'electron-updater'
import type { EventEmitter } from 'node:events'

// the software center updates Flatpak apps, electron-updater would download the .deb and fail to install it with dpkg
if (!env.FLATPAK_ID) {
  // autoUpdater.forceDevUpdateConfig = true
  autoUpdater.setFeedURL({ url: 'https://api.hayase.watch/files', provider: 'generic' })
  autoUpdater.checkForUpdates()
}

export default class Updater {
  hasUpdate = false
  flatpak = env.FLATPAK_ID ? new Flatpak() : undefined
  updater: EventEmitter = this.flatpak ?? autoUpdater

  constructor () {
    this.updater.on('update-downloaded', () => {
      this.hasUpdate = true
    })

    if (!this.flatpak) setInterval(() => autoUpdater.checkForUpdates(), 1000 * 60 * 30).unref() // 30 mins
  }

  onProgress (listener: (percent: number) => void) {
    this.updater.on('download-progress', (progress: ProgressInfo) => listener(progress.percent))
    this.updater.on('update-downloaded', () => listener(100))
  }

  async checkForUpdates () {
    if (this.flatpak) await this.flatpak.check()
    else await autoUpdater.checkForUpdates()
  }

  async updateReady () {
    if (this.flatpak) return await this.flatpak.updateReady()
    const update = await autoUpdater.checkForUpdates()
    if (!update) throw new Error('No update available')
    await update.downloadPromise
  }

  install (forceRunAfter = false) {
    if (this.hasUpdate) {
      if (this.flatpak) this.flatpak.quitAndInstall(forceRunAfter)
      else autoUpdater.quitAndInstall(true, forceRunAfter)
      this.hasUpdate = false
      return true
    }
    return false
  }
}
