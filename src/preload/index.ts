import { wrap } from 'abslink/electron'
import { contextBridge, ipcRenderer } from 'electron'

import type IPC from '../main/ipc.ts'
import type { Native } from 'native'

ipcRenderer.send('preload-done')

const windowLoaded = new Promise<void>(resolve => {
  contextBridge.exposeInMainWorld('sendPort', () => resolve())
})

ipcRenderer.once('port', async ({ ports }) => {
  if (!ports[0]) return
  await windowLoaded
  // eslint-disable-next-line no-undef
  window.postMessage('TORRENT_PORT', '*', ports)
})

const version = ipcRenderer.invoke('version')

const main = wrap<typeof IPC.prototype>(ipcRenderer)

const native: Partial<Native> = {
  openURL: (url: string) => main.openURL(url),
  selectPlayer: () => main.selectPlayer(),
  selectDownload: async () => {
    const path = await main.selectDownload()
    // TODO
    // await (await torrent).verifyDirectoryPermissions(path)
    return path
  },
  setAngle: (angle: string) => main.setAngle(angle),
  getLogs: () => main.getLogs(),
  getDeviceInfo: () => main.getDeviceInfo(),
  openUIDevtools: () => main.openUIDevtools(),
  minimise: () => main.minimise(),
  maximise: () => main.maximise(),
  close: () => main.close(),
  checkUpdate: () => main.checkUpdate(),
  updateAndRestart: () => main.updateAndRestart(),
  updateReady: () => main.updateReady(),
  toggleDiscordDetails: (bool: boolean) => main.toggleDiscordDetails(bool),
  setMediaSession: async (metadata, id) => {
    navigator.mediaSession.metadata = new MediaMetadata({ title: metadata.title, artist: metadata.description, artwork: [{ src: metadata.image }] })
    await main.setMediaSession(metadata, id)
  },
  setPositionState: async e => {
    navigator.mediaSession.setPositionState(e)
    await main.setPositionState(e)
  },
  setPlayBackState: async e => {
    navigator.mediaSession.playbackState = e
    await main.setPlayBackState(e)
  },
  updateSettings: (settings) => main.updateSettings(settings),
  setHideToTray: (enabled: boolean) => main.setHideToTray(enabled),
  isApp: true,
  spawnPlayer: (url) => main.spawnPlayer(url),
  setDOH: (dns) => main.setDOH(dns),
  updateProgress: async (cb: (progress: number) => void) => {
    // the less proxies used, the better, could use proxy(cb) here, but this has less overhead
    main.updateProgress()
    ipcRenderer.on('update-progress', (_e, data) => cb(data))
  },
  downloadProgress: (percent: number) => main.downloadProgress(percent),
  restart: () => main.restart(),
  focus: () => main.focus(),
  transparency: (enabled: boolean) => main.setTransparency(enabled),
  setZoom: (scale: number) => main.setZoom(scale),
  version: () => version,
  navigate: async (cb) => {
    ipcRenderer.on('navigate', (_e, data) => cb(data))
  },
  share: async (data) => {
    if (!data) return
    await navigator.clipboard.writeText(data.url ?? data.text ?? data.title!)
  },
  defaultTransparency: () => false
}

try {
  contextBridge.exposeInMainWorld('native', native)
} catch (error) {
  console.error(error)
}
// const {electron, chrome, node} = electron.process.versions
