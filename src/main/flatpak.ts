import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { env } from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

import { app, shell } from 'electron'
import log from 'electron-log/main'

// Flatpak writes this into the running version's files once a newer version is installed
const UPDATED = '/app/.updated'

// electron-updater for Flatpak, the user's software center installs the update
export default class Flatpak extends EventEmitter {
  hasUpdate = false
  error: Error | undefined

  constructor () {
    super()
    this.check()
    setInterval(() => this.check(), 1000 * 60 * 30).unref() // 30 mins
  }

  async check () {
    this.error = undefined
    try {
      if (!existsSync(UPDATED)) {
        const res = await fetch(`https://flathub.org/api/v2/appstream/${env.FLATPAK_ID}`)
        // not on Flathub, so there is nothing to update from
        if (res.status === 404) return
        if (!res.ok) throw new Error('Flathub returned ' + res.status)
        const { releases } = await res.json() as { releases: Array<{ version: string }> }
        if (releases[0]?.version === app.getVersion()) return
      }
      this.hasUpdate = true
      this.emit('update-downloaded')
    } catch (err) {
      log.error('Failed to check Flathub for updates:', err)
      this.error = err as Error
    }
  }

  async updateReady () {
    await this.check()
    if (this.error) throw this.error
    if (!this.hasUpdate) throw new Error('No update available')
  }

  // restarts once the software center installed the update
  async update () {
    if (!existsSync(UPDATED)) await shell.openExternal(`appstream://${env.FLATPAK_ID}`)
    while (!existsSync(UPDATED)) await sleep(1000)
  }

  async quitAndInstall (forceRunAfter: boolean) {
    if (forceRunAfter) {
      // the new instance would quit if this one still held the lock
      app.releaseSingleInstanceLock()
      // an empty command runs the app's default command, --verbose prints child_pid once it runs
      const child = spawn('flatpak-spawn', ['--latest-version', '--verbose', ''], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.once('error', err => log.error('Failed to relaunch Flatpak:', err))
      for await (const chunk of child.stderr) {
        if (String(chunk).includes('child_pid')) break
      }
      // flatpak-spawn waits for the new instance and keeps this one's files open, SIGKILL stops it without forwarding the signal
      child.kill('SIGKILL')
    }
    app.quit()
  }
}
