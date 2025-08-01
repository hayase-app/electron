import { statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { expose } from 'abslink/w3c'
import TorrentClient from 'torrent-client'
import profiler from 'v8-profiler-next'

import type { TorrentSettings } from 'native'

interface Message {
  id: string
  data: unknown
}

let TMP: string
try {
  TMP = join(statSync('/tmp') && '/tmp', 'webtorrent')
} catch (err) {
  TMP = join(typeof os.tmpdir === 'function' ? os.tmpdir() : '/', 'webtorrent')
}

const PROFILE_NAME = 'torrent-client-trace'

async function profile (seconds: number) {
  profiler.setGenerateType(1)

  profiler.startProfiling(PROFILE_NAME, true)
  const profile = await new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      const profile = profiler.stopProfiling(PROFILE_NAME)
      profile.export((error, result) => {
        if (error) {
          reject(error)
          return
        }
        if (!result) {
          reject(new Error('No profile data available'))
          return
        }
        resolve(result)
        profile.delete()
      })
    }, seconds * 1000)
  })

  await writeFile(join(TMP, `${PROFILE_NAME}.cpuprofile`), profile)
}

process.parentPort.on('message', ({ ports, data: _data }) => {
  let settings: TorrentSettings & { path: string } | undefined
  const { id, data } = _data as Message
  if (id === 'settings') settings = data as TorrentSettings & { path: string }
  if (id === 'destroy') tclient?.destroy()

  if (ports[0]) {
    ports[0].start()
    tclient ??= new TorrentClient(settings!, TMP)
    tclient.profile = profile
    // re-exposing leaks memory, but not that much, so it's fine
    expose(tclient, ports[0] as unknown as MessagePort)
  } else if (settings) {
    tclient?.updateSettings(settings)
  }
})

let tclient: TorrentClient | undefined
