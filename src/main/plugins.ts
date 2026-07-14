import { existsSync, openAsBlob } from 'node:fs'
import {
  mkdir,
  readdir,
  rm,
  writeFile,
  cp
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

import { BrowserWindow, dialog } from 'electron'
import log from 'electron-log/main'
import read from 'zip-go/lib/read.js'

import type { PluginInfo } from 'native'

function joinSafe (base: string, ...paths: string[]): string {
  const resolved = resolve(base, ...paths)
  if (relative(resolve(base), resolved).startsWith('..')) throw new Error('Path traversal detected')
  return resolved
}

const plugins = join(process.resourcesPath, 'plugins')

async function * pluginPaths () {
  if (!existsSync(plugins)) return
  for (const entry of await readdir(plugins, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (existsSync(join(plugins, entry.name, 'manifest.json'))) {
        yield join(plugins, entry.name)
      }
    }
  }
}

function crxZipOffset (buf: ArrayBuffer): number {
  const view = new DataView(buf)
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'Cr24') throw new Error('Invalid CRX file')
  const version = view.getUint32(4, true)
  if (version === 2) {
    return 16 + view.getUint32(8, true) + view.getUint32(12, true)
  }
  if (version === 3) {
    return 12 + view.getUint32(8, true)
  }
  throw new Error(`Unsupported CRX version: ${version}`)
}

function toPluginMeta (raw: Record<string, unknown>) {
  return {
    name: (raw.name as string) ?? 'Unknown',
    version: (raw.version as string) ?? '0.0.0',
    description: (raw.description as string) ?? '',
    permissions: [...new Set([
      ...(raw.permissions as string[] ?? []),
      ...(raw.host_permissions as string[] ?? [])
    ])]
  }
}

async function manifestFromBlob (blob: Blob): Promise<Record<string, unknown>> {
  for await (const entry of read(blob)) {
    if (entry.name.replace(/^.\//, '') === 'manifest.json') {
      return JSON.parse(await entry.text())
    }
  }
  throw new Error('No manifest.json found in the extension')
}

async function extractZip (blob: Blob, destDir: string): Promise<void> {
  for await (const entry of read(blob)) {
    const entryName = entry.name.replace(/^.\//, '')
    const destPath = joinSafe(destDir, entryName)
    if (entry.directory) {
      await mkdir(destPath, { recursive: true })
    } else {
      await mkdir(dirname(destPath), { recursive: true })
      await writeFile(destPath, Buffer.from(await entry.arrayBuffer()))
    }
  }
}

export default class Plugins {
  sesh
  parent
  pendingImports = new Map<string, Blob | string >()

  constructor (parent: BrowserWindow) {
    this.parent = parent
    this.sesh = parent.webContents.session
    this.load()
  }

  async load () {
    for await (const dir of pluginPaths()) {
      try {
        const { id, manifest } = await this.sesh.extensions.loadExtension(dir, { allowFileAccess: false })
        log.info(`[Plugins] Loaded: ${manifest.name} (${id})`)
      } catch (err) {
        log.error(`[Plugins] Failed to load plugin from ${dir}:`, err)
      }
    }
  }

  import (id?: string): Promise<PluginInfo> {
    if (id) return this._finalizeImport(id)
    return this._inspect()
  }

  async _inspect (): Promise<PluginInfo> {
    const result = await dialog.showOpenDialog(this.parent, {
      title: 'Import Extension',
      filters: [{ name: 'Extension Files', extensions: ['zip', 'crx', 'json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) throw new Error('No file selected')

    const filePath = result.filePaths[0]!
    const ext = extname(filePath).toLowerCase()
    let raw: Record<string, unknown>
    let pending: Blob | string

    const blob = await openAsBlob(filePath)
    if (ext === '.zip' || ext === '.crx') {
      const zipBlob = ext === '.crx'
        ? blob.slice(crxZipOffset(await blob.slice(0, 16).arrayBuffer()))
        : blob
      raw = await manifestFromBlob(zipBlob)
      pending = zipBlob
    } else {
      raw = JSON.parse(await blob.text())
      pending = dirname(filePath)
    }

    const id = (raw.name as string) ?? basename(filePath, ext)
    this.pendingImports.set(id, pending)
    return { id, ...toPluginMeta(raw) }
  }

  async _finalizeImport (id: string): Promise<PluginInfo> {
    const pending = this.pendingImports.get(id)
    if (!pending) throw new Error('No pending import found for this plugin')
    this.pendingImports.delete(id)

    const destDir = joinSafe(plugins, id)
    if (existsSync(destDir)) throw new Error(`Plugin "${id}" already exists`)

    if (typeof pending === 'string') {
      await cp(pending, destDir, { recursive: true })
    } else {
      await extractZip(pending, destDir)
    }

    try {
      const { id: extId, manifest } = await this.sesh.extensions.loadExtension(destDir, { allowFileAccess: false })
      log.info(`[Plugins] Imported: ${manifest.name} (${extId})`)
      return { id: extId, ...toPluginMeta(manifest as Record<string, unknown>) }
    } catch (err) {
      await rm(destDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  _getURL (extensionId: string) {
    const ext = this.sesh.extensions.getExtension(extensionId)
    if (!ext) return null
    const manifest = ext.manifest as Record<string, unknown>
    const action = (manifest.action ?? manifest.browser_action) as Record<string, unknown> | undefined
    const popup = action?.default_popup
    return typeof popup === 'string' ? `chrome-extension://${extensionId}/${popup}` : null
  }

  async popup (id: string) {
    const popupUrl = this._getURL(id)
    if (!popupUrl) throw new Error('No popup window defined for this plugin!')

    const ext = this.sesh.extensions.getExtension(id)
    if (!ext) throw new Error('Could not find plugin!')
    const manifest = ext.manifest as Record<string, string | undefined>
    const action = (manifest.action ?? manifest.browser_action) as Record<string, string | undefined> | undefined
    const title = '!UNTRUSTED POPUP! ' + ((action?.default_title) ?? (manifest.name) ?? 'Plugin')

    const popup = new BrowserWindow({
      width: 400,
      height: 600,
      parent: this.parent,
      modal: true,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#000000',
      resizable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      title,
      webPreferences: { sandbox: true, webSecurity: true }
    })

    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('will-navigate', (e, url) => {
      if (new URL(url).origin !== `chrome-extension://${id}`) e.preventDefault()
    })

    await popup.loadURL(popupUrl)
  }

  async delete (id: string) {
    const ext = this.sesh.extensions.getAllExtensions().find(e => e.id === id)
    if (!ext) throw new Error('Plugin not found!')
    try {
      this.sesh.extensions.removeExtension(ext.id)
    } catch (err) {
      log.error(`[Plugins] Failed to unload extension ${id} from session:`, err)
    }

    await rm(joinSafe(plugins, ext.name), { recursive: true, force: true })
    log.info(`[Plugins] Deleted: ${id}`)
  }

  list () {
    return this.sesh.extensions.getAllExtensions().map<PluginInfo>(ext => {
      const manifest = ext.manifest as Record<string, unknown>
      return { id: ext.id, ...toPluginMeta(manifest) }
    })
  }
}
