import { proxy } from 'abslink'
import { wrap } from 'abslink/electron'
import { wrap as wrapPort } from 'abslink/w3c'
import { contextBridge, ipcRenderer } from 'electron'

import type TorrentClient from '../main/background/client.ts'
import type IPC from '../main/ipc.ts'
import type { Native } from '../types.d.ts'
import type { Remote } from 'abslink'

const isNewWindows = process.platform === 'win32' && Number(process.getSystemVersion().split('.').pop()) >= 22621

ipcRenderer.send('preload-done')

const torrent = new Promise<Remote<TorrentClient>>(resolve => {
  ipcRenderer.once('port', ({ ports }) => {
    if (!ports[0]) return
    ports[0].start()
    resolve(wrapPort<TorrentClient>(ports[0]) as unknown as Remote<TorrentClient>)
  })
})
const version = ipcRenderer.invoke('version')

const main = wrap<typeof IPC.prototype>(ipcRenderer)

const native: Partial<Native> = {
  openURL: (url: string) => main.openURL(url),
  selectPlayer: () => main.selectPlayer(),
  selectDownload: () => main.selectDownload(),
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
  checkAvailableSpace: async () => await (await torrent).checkAvailableSpace(),
  checkIncomingConnections: async (port) => await (await torrent).checkIncomingConnections(port),
  updatePeerCounts: async (hashes) => await (await torrent).scrape(hashes),
  playTorrent: async (id) => await (await torrent).playTorrent(id),
  attachments: async (hash, id) => await (await torrent).attachments.attachments(hash, id),
  tracks: async (hash, id) => await (await torrent).attachments.tracks(hash, id),
  subtitles: async (hash, id, cb) => await (await torrent).attachments.subtitle(hash, id, proxy(cb)),
  errors: async (cb) => await (await torrent).errors(proxy(cb)),
  chapters: async (hash, id) => await (await torrent).attachments.chapters(hash, id),
  torrentStats: async (hash) => await (await torrent).torrentStats(hash),
  torrents: async () => await (await torrent).torrents(),
  updateSettings: (settings) => main.updateSettings(settings),
  cachedTorrents: async () => await (await torrent).cached(),
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
  defaultTransparency: () => !isNewWindows,
  debug: async (levels) => await (await torrent).debug(levels)
}

try {
  contextBridge.exposeInMainWorld('native', native)
} catch (error) {
  console.error(error)
}
// const {electron, chrome, node} = electron.process.versions
