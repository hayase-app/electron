import { autoUpdater } from 'electron-updater'
import { shell } from 'electron'

autoUpdater.checkForUpdatesAndNotify()
export default class Updater {
  hasUpdate = false

  constructor () {
    autoUpdater.on('update-downloaded', () => {
      this.hasUpdate = true
    })
  }

  install (forceRunAfter = false) {
    if (this.hasUpdate) {
      autoUpdater.quitAndInstall(true, forceRunAfter)
      if (process.platform === 'darwin') shell.openExternal('https://miru.watch/download')
      this.hasUpdate = false
      return true
    }
    return false
  }
}
