import { readFile, writeFile, statfs, unlink, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exit } from 'node:process'
import { statSync } from 'node:fs'
import os from 'node:os'
import querystring from 'querystring'

import WebTorrent from 'webtorrent'
import MemoryChunkStore from 'memory-chunk-store'
import bencode from 'bencode'
import parseTorrent from 'parse-torrent'
// @ts-expect-error no export
import HTTPTracker from 'http-tracker'
import { hex2bin, arr2hex, text2arr, type TypedArray, concat } from 'uint8-util'
import debug from 'debug'

import attachments from './attachments.ts'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TorrentFile, TorrentInfo, TorrentSettings } from '../../types'
import type Torrent from 'webtorrent/lib/torrent.js'
import { randomBytes } from 'node:crypto'

let TMP: string
try {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  TMP = join(statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  TMP = join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
}

interface ScrapeResponse { hash: string, complete: string, downloaded: string, incomplete: string }

const sleep = (t: number) => new Promise(resolve => setTimeout(resolve, t).unref())

const querystringStringify = (obj: Record<string, string>) => {
  let ret = querystring.stringify(obj, undefined, undefined, { encodeURIComponent: escape })
  ret = ret.replace(/[@*/+]/g, char => // `escape` doesn't encode the characters @*/+ so we do it manually
  `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return ret
}

interface TorrentMetadata {
  info: unknown
  announce?: string[]
  urlList?: string[]
  private?: boolean
  bitfield?: TypedArray
}

interface TorrentData {
  info: unknown
  'announce-list'?: Uint8Array[][]
  'url-list'?: string[]
  private?: number
  _bitfield?: TypedArray
  announce?: string
}

function structTorrent (parsed: TorrentMetadata) {
  const torrent: TorrentData = {
    info: parsed.info,
    'url-list': parsed.urlList ?? [],
    _bitfield: parsed.bitfield,
    'announce-list': (parsed.announce ?? []).map(url => [text2arr(url)])
  }
  torrent.announce ??= parsed.announce?.[0]
  if (parsed.private !== undefined) torrent.private = Number(parsed.private)

  return torrent
}

const ANNOUNCE = [
  atob('d3NzOi8vdHJhY2tlci5vcGVud2VidG9ycmVudC5jb20='),
  atob('d3NzOi8vdHJhY2tlci53ZWJ0b3JyZW50LmRldg=='),
  atob('d3NzOi8vdHJhY2tlci5maWxlcy5mbTo3MDczL2Fubm91bmNl'),
  atob('d3NzOi8vdHJhY2tlci5idG9ycmVudC54eXov'),
  atob('dWRwOi8vb3Blbi5zdGVhbHRoLnNpOjgwL2Fubm91bmNl'),
  atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci5vcGVudHJhY2tyLm9yZzoxMzM3L2Fubm91bmNl'),
  atob('dWRwOi8vZXhvZHVzLmRlc3luYy5jb206Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vdHJhY2tlci5jb3BwZXJzdXJmZXIudGs6Njk2OS9hbm5vdW5jZQ=='),
  atob('dWRwOi8vOS5yYXJiZy50bzoyNzEwL2Fubm91bmNl'),
  atob('dWRwOi8vdHJhY2tlci50b3JyZW50LmV1Lm9yZzo0NTEvYW5ub3VuY2U='),
  atob('aHR0cDovL29wZW4uYWNnbnh0cmFja2VyLmNvbTo4MC9hbm5vdW5jZQ=='),
  atob('aHR0cDovL2FuaWRleC5tb2U6Njk2OS9hbm5vdW5jZQ=='),
  atob('aHR0cDovL3RyYWNrZXIuYW5pcmVuYS5jb206ODAvYW5ub3VuY2U=')
]

const client = Symbol('client')
const server = Symbol('server')
const store = Symbol('store')
const path = Symbol('path')
const opts = Symbol('opts')
const tracker = new HTTPTracker({}, atob('aHR0cDovL255YWEudHJhY2tlci53Zjo3Nzc3L2Fubm91bmNl'))

class Store {
  cacheFolder
  constructor (path: string) {
    const targetPath = join(path, 'hayase-cache')
    this.cacheFolder = mkdir(targetPath, { recursive: true }).then(() => targetPath)
  }

  async get (key?: string): Promise<TorrentData | null> {
    if (!key) return null
    try {
      return bencode.decode(await readFile(join(await this.cacheFolder, key)))
    } catch (err) {
      return null
    }
  }

  async set (key: string, value: TorrentData) {
    return await writeFile(join(await this.cacheFolder, key), bencode.encode(value))
  }

  async delete (key: string) {
    try {
      return await unlink(join(await this.cacheFolder, key))
    } catch (err) {
      return null
    }
  }

  async list () {
    try {
      return (await readdir(await this.cacheFolder, { withFileTypes: true }))
        .filter(item => !item.isDirectory())
        .map(({ name }) => name)
    } catch (err) {
      return []
    }
  }
}

const megaBitsToBytes = 1024 * 1024 / 8

process.on('uncaughtException', err => console.error(err))

// this could... be a bad idea and needs to be verified
const peerId = concat([[45, 113, 66, 53, 48, 51, 48, 45], randomBytes(12)])

export default class TorrentClient {
  [client]: WebTorrent;
  [server]: Server;
  [store]: Store;
  [path]: string
  [opts]: Record<string, unknown>

  attachments = attachments

  streamed = false
  persist = false

  constructor (settings: TorrentSettings & {path: string}) {
    this[opts] = {
      dht: !settings.torrentDHT,
      utPex: !settings.torrentPeX,
      downloadLimit: Math.round(settings.torrentSpeed * megaBitsToBytes),
      uploadLimit: Math.round(settings.torrentSpeed * megaBitsToBytes * 1.2),
      natUpnp: 'permanent',
      torrentPort: settings.torrentPort,
      dhtPort: settings.dhtPort,
      maxConns: settings.maxConns,
      peerId
    }
    this[client] = new WebTorrent(this[opts])
    this[client].on('error', console.error)
    this[server] = this[client].createServer({}, 'node').listen(0)
    this[path] = settings.path || TMP
    this[store] = new Store(this[path])
    this.streamed = settings.torrentStreamedDownload
    this.persist = settings.torrentPersist
  }

  updateSettings (settings: TorrentSettings) {
    this[client].throttleDownload(Math.round(settings.torrentSpeed * megaBitsToBytes))
    this[client].throttleUpload(Math.round(settings.torrentSpeed * megaBitsToBytes * 1.2))
    this[opts] = {
      dht: !settings.torrentDHT,
      utPex: !settings.torrentPeX,
      downloadLimit: Math.round(settings.torrentSpeed * megaBitsToBytes),
      uploadLimit: Math.round(settings.torrentSpeed * megaBitsToBytes * 1.2),
      natUpnp: 'permanent',
      torrentPort: settings.torrentPort,
      dhtPort: settings.dhtPort,
      maxConns: settings.maxConns,
      peerId
    }
    this.streamed = settings.torrentStreamedDownload
    this.persist = settings.torrentPersist
  }

  cleanupLast: undefined | (() => Promise<void>) = undefined

  // WARN: ONLY CALL THIS DURING SETUP!!!
  async checkIncomingConnections (torrentPort: number): Promise<boolean> {
    await this.cleanupLast?.()
    await new Promise(resolve => this[client].destroy(resolve))

    return await new Promise(resolve => {
      const checkClient = new WebTorrent({ torrentPort, natUpnp: 'permanent', peerId })
      const torrent = checkClient.add(
        atob('bWFnbmV0Oj94dD11cm46YnRpaDpkZDgyNTVlY2RjN2NhNTVmYjBiYmY4MTMyM2Q4NzA2MmRiMWY2ZDFjJmRuPUJpZytCdWNrK0J1bm55JnRyPXVkcCUzQSUyRiUyRmV4cGxvZGllLm9yZyUzQTY5NjkmdHI9dWRwJTNBJTJGJTJGdHJhY2tlci5jb3BwZXJzdXJmZXIudGslM0E2OTY5JnRyPXVkcCUzQSUyRiUyRnRyYWNrZXIuZW1waXJlLWpzLnVzJTNBMTMzNyZ0cj11ZHAlM0ElMkYlMkZ0cmFja2VyLmxlZWNoZXJzLXBhcmFkaXNlLm9yZyUzQTY5NjkmdHI9dWRwJTNBJTJGJTJGdHJhY2tlci5vcGVudHJhY2tyLm9yZyUzQTEzMzc='),
        { store: MemoryChunkStore }
      )
      // patching library to not create outgoing connections
      torrent._drain = () => undefined
      checkClient.on('error', console.error)
      const cleanup = this.cleanupLast = async (val = false) => {
        if (checkClient.destroyed) return
        await new Promise(resolve => checkClient.destroy(resolve))
        this[client] = new WebTorrent(this[opts])
        this[client].on('error', console.error)
        this[server] = this[client].createServer({}, 'node').listen(0)
        resolve(val)
      }

      setTimeout(() => cleanup(), 60_000).unref()
      torrent.on('wire', () => cleanup(true))
    })
  }

  async checkAvailableSpace () {
    const { bsize, bavail } = await statfs(this[path])
    return bsize * bavail
  }

  async scrape (infoHashes: string[]): Promise<ScrapeResponse[]> {
    // this seems to give the best speed, and lowest failure rate
    const MAX_ANNOUNCE_LENGTH = 1300 // it's likely 2048, but lets undercut it
    const RATE_LIMIT = 200 // ms

    const ANNOUNCE_LENGTH = tracker.scrapeUrl.length

    let batch: string[] = []
    let currentLength = ANNOUNCE_LENGTH // fuzz the size a little so we don't always request the same amt of hashes
    const results: ScrapeResponse[] = []

    const scrape = async () => {
      if (results.length) await sleep(RATE_LIMIT)
      const data = await new Promise((resolve, reject) => {
        tracker._request(tracker.scrapeUrl, { info_hash: batch }, (err: Error | null, data: unknown) => {
          if (err) return reject(err)
          resolve(data)
        })
      })

      const { files } = data as { files: Array<Pick<ScrapeResponse, 'complete' | 'downloaded' | 'incomplete'>> }
      const result = []
      for (const [key, data] of Object.entries(files)) {
        result.push({ hash: key.length !== 40 ? arr2hex(text2arr(key)) : key, ...data })
      }

      results.push(...result)
      batch = []
      currentLength = ANNOUNCE_LENGTH
    }

    for (const infoHash of infoHashes.sort(() => 0.5 - Math.random()).map(infoHash => hex2bin(infoHash))) {
      const qsLength = querystringStringify({ info_hash: infoHash }).length + 1 // qs length + 1 for the & or ? separator
      if (currentLength + qsLength > MAX_ANNOUNCE_LENGTH) {
        await scrape()
      }

      batch.push(infoHash)
      currentLength += qsLength
    }
    if (batch.length) await scrape()

    return results
  }

  async toInfoHash (torrentId: string) {
    let parsed: { infoHash: string } | undefined

    // @ts-expect-error bad typedefs
    // eslint-disable-next-line @typescript-eslint/await-thenable
    try { parsed = await parseTorrent(torrentId) } catch (err) {}
    return parsed?.infoHash
  }

  async playTorrent (id: string): Promise<TorrentFile[]> {
    if (this[client].torrents[0]) {
      const hash = this[client].torrents[0].infoHash
      // @ts-expect-error bad typedefs
      await this[client].remove(this[client].torrents[0], { destroyStore: !this.persist })
      if (!this.persist) await this[store].delete(hash)
    }

    const torrent: Torrent = await this[client].get(id) ?? this[client].add(id, {
      path: this[path],
      announce: ANNOUNCE,
      bitfield: (await this[store].get(await this.toInfoHash(id)))?._bitfield,
      deselect: this.streamed
    })

    if (!torrent.ready) await new Promise(resolve => torrent.once('ready', resolve))

    this.attachments.register(torrent.files, torrent.infoHash)

    const baseInfo = structTorrent({
      // @ts-expect-error bad typedefs
      info: torrent.info,
      announce: torrent.announce,
      private: torrent.private,
      urlList: torrent.urlList,
      bitfield: torrent.bitfield!.buffer
    })

    const savebitfield = () => this[store].set(torrent.infoHash, baseInfo)
    const finish = () => {
      savebitfield()
      clearInterval(interval)
    }

    const interval = setInterval(savebitfield, 1000 * 20).unref()

    torrent.on('done', finish)
    torrent.on('close', finish)

    return torrent.files.map(({ name, type, size, path, streamURL }, id) => ({
      hash: torrent.infoHash, name, type, size, path, id, url: 'http://localhost:' + (this[server].address() as AddressInfo).port + streamURL
    }))
  }

  async cached () {
    return await this[store].list()
  }

  errors (cb: (errors: Error) => void) {
    this[client].on('error', err => cb(err))
    process.on('uncaughtException', err => cb(err))
  }

  debug (levels: string) {
    debug.disable()
    if (levels) debug.enable(levels)
  }

  torrents () {
    return this[client].torrents.map(t => this.makeStats(t))
  }

  async torrentStats (id: string) {
    const torrent = await this[client].get(id)
    if (!torrent) throw new Error('Torrent not found')
    return this.makeStats(torrent)
  }

  makeStats (torrent: Torrent): TorrentInfo {
    const seeders = torrent.wires.filter(wire => wire.isSeeder).length
    const leechers = torrent.wires.length - seeders
    const peers = torrent._peersLength
    // @ts-expect-error bad typedefs
    const { infoHash: hash, timeRemaining: eta, length: size, name, progress, downloadSpeed: down, uploadSpeed: up, downloaded } = torrent

    return { hash, name, peers, progress, down, up, seeders, leechers, size, downloaded, eta }
  }

  async destroy () {
    await Promise.all([
      attachments.destroy(),
      new Promise(resolve => this[client].destroy(resolve)),
      new Promise(resolve => tracker.destroy(resolve))
    ])
    exit()
  }
}
