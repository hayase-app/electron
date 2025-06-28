import { autoUpdater } from 'electron-updater'

autoUpdater.checkForUpdates()
export default class Updater {
  hasUpdate = false

  constructor () {
    autoUpdater.on('update-downloaded', () => {
      this.hasUpdate = true
    })

    setInterval(() => autoUpdater.checkForUpdates(), 1000 * 60 * 30).unref() // 30 mins
  }

  install (forceRunAfter = false) {
    if (this.hasUpdate) {
      autoUpdater.quitAndInstall(true, forceRunAfter)
      this.hasUpdate = false
      return true
    }
    return false
  }
}
