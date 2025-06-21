import path from 'path'

import { app, shell, type BrowserWindow } from 'electron'

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('hayase', process.execPath, [path.resolve(process.argv[1]!)])
  }
} else {
  app.setAsDefaultProtocolClient('hayase')
}

const NAVIGATE_TARGETS = {
  schedule: 'schedule',
  anime: 'anime',
  w2g: 'w2g'
} as const

export default class Protocol {
  protocolRx = /hayase:\/\/([a-z0-9]+)\/(.*)/i

  window
  constructor (window: BrowserWindow) {
    this.window = window

    // this is deprecated.... probably?
    // protocol.registerHttpProtocol('hayase', (req) => {
    // const token = req.url.slice(7)
    // this.window.loadURL(development ? 'http://localhost:5000/app.html' + token : `file://${path.join(__dirname, '/app.html')}${token}`)
    // })

    app.on('open-url', (event, url) => {
      event.preventDefault()
      this.handleProtocol(url)
    })

    if (process.argv.length >= 2 && !process.defaultApp) {
      // TODO: verify this works, might need to wait for main window to load... somehow
      for (const line of process.argv) {
        this.handleProtocol(line)
      }
    }
  }

  navigateTarget () {
    if (process.argv.length < 2 || process.defaultApp) return ''

    for (const line of process.argv) {
      const parsed = this._parseProtocol(line)
      if (parsed && parsed.target in NAVIGATE_TARGETS) {
        const targetValue = NAVIGATE_TARGETS[parsed.target as keyof typeof NAVIGATE_TARGETS]
        return `app/${targetValue}/${parsed.value ?? ''}`
      }
    }
    return ''
  }

  _parseProtocol (text: string) {
    const match = text.match(this.protocolRx)
    if (!match) return null
    return {
      target: match[1]!,
      value: match[2]
    }
  }

  handleProtocol (text: string) {
    const parsed = this._parseProtocol(text)
    if (!parsed) return
    if (parsed.target === 'donate') shell.openExternal('https://github.com/sponsors/ThaUnknown/')

    this.window.webContents.send('navigate', parsed)
  }
}
