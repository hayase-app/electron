import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'
import log from 'electron-log/main'

const isNewWindows = process.platform === 'win32' && Number(release().split('.').pop()) >= 22621

const DEFAULTS = {
  angle: 'default',
  player: '',
  torrentPath: '',
  transparency: !isNewWindows,
  torrentSettings: {
    torrentPersist: false,
    torrentDHT: false,
    torrentStreamedDownload: true,
    torrentSpeed: 40,
    maxConns: 50,
    torrentPort: 0,
    dhtPort: 0,
    torrentPeX: false
  }
}

class Store {
  path: string
  data = DEFAULTS
  constructor (configName: string) {
    this.path = join(app.getPath('userData'), configName + '.json')

    this.data = parseDataFile(this.path)
  }

  get<K extends keyof Store['data']> (key: K): Store['data'][K] {
    return this.data[key]
  }

  set<K extends keyof Store['data']> (key: K, val: Store['data'][K]) {
    this.data[key] = val
    writeFile(this.path, JSON.stringify(this.data))
  }
}

function parseDataFile (filePath: string) {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(filePath).toString()) as typeof DEFAULTS) }
  } catch (error) {
    log.error('Failed to load native settings: ', error)
    return DEFAULTS
  }
}

export default new Store('settings')
