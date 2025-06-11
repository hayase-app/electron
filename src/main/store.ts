import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

import { app } from 'electron'
const DEFAULTS = {
  angle: 'default',
  player: '',
  torrentPath: '',
  transparency: true,
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
    // TODO: should we log this?
    return DEFAULTS
  }
}

export default new Store('settings')
