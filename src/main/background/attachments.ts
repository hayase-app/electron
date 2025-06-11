import { createServer } from 'node:http'

import Metadata from 'matroska-metadata'

import type EventEmitter from 'node:events'
import type { AddressInfo } from 'node:net'

export default new class Attachments {
  destroyed = false
  filemap = new Map<string, Metadata & EventEmitter>()
  server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url!, 'http://localhost')
      const [hashid, number] = pathname.split('/').slice(1)
      if (!hashid || !number) throw new Error('Invalid request')

      const metadata = this.filemap.get(hashid)
      if (!metadata) throw new Error('File not found')

      const attachment = (await metadata.getAttachments())[Number(number)]
      if (!attachment) throw new Error('Attachment not found')

      res.writeHead(200, { 'Content-Type': attachment.mimetype, 'Access-Control-Allow-Origin': '*' })
      res.end(attachment.data)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
  }).listen()

  subtitle (hash: string, id: number, cb: (subtitle: { text: string, time: number, duration: number }, trackNumber: number) => void) {
    const metadata = this.filemap.get(hash + id)
    if (!metadata) throw new Error('File not found')
    metadata.removeAllListeners('subtitle')
    metadata.on('subtitle', (a, b) => cb(a, b))
  }

  register (files: Array<File & EventEmitter>, hash: string) {
    this.filemap.clear()
    files.forEach((file, id) => {
      if (file.name.endsWith('.mkv') || file.name.endsWith('.webm')) {
        const metadata = new Metadata(file)
        this.filemap.set(hash + id, metadata as Metadata & EventEmitter)
        file.on('iterator', ({ iterator }: { iterator: AsyncIterable<Uint8Array> }, cb: (it: AsyncIterable<Uint8Array>) => void) => {
          if (this.destroyed) return cb(iterator)
          cb(metadata.parseStream(iterator))
        })
      }
    })
  }

  async attachments (hash: string, id: number) {
    const metadata = this.filemap.get(hash + id)
    if (!metadata) throw new Error('File not found')
    return (await metadata.getAttachments()).map(({ filename, mimetype }, number) => {
      return { filename, mimetype, id, url: 'http://localhost:' + (this.server.address() as AddressInfo).port + '/' + hash + id + '/' + number }
    })
  }

  chapters (hash: string, id: number) {
    const metadata = this.filemap.get(hash + id)
    if (!metadata) throw new Error('File not found')
    return metadata.getChapters()
  }

  tracks (hash: string, id: number) {
    const metadata = this.filemap.get(hash + id)
    if (!metadata) throw new Error('File not found')
    return metadata.getTracks() as Promise<Array<{ number: string, language?: string, type: string, header: string }>>
  }

  async destroy () {
    this.destroyed = true
    await new Promise(resolve => this.server.close(resolve))
  }
}()
