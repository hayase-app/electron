import { Client } from '@xhayper/discord-rpc/dist/Client'

import type { SessionMetadata } from 'native'

function throttle <T extends (...args: any[]) => unknown>(callback: T, waitFor: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timeout) return
    timeout = setTimeout(() => {
      timeout = undefined
      callback(...args)
    }, waitFor).unref()
  }
}

export default class Discord {
  discord = new Client({ transport: { type: 'ipc' }, clientId: '954855428355915797' })
  debouncedDiscordRPC = throttle(() => this.setDiscordRPC(), 2000)
  position: MediaPositionState | undefined = undefined
  playback: 'none' | 'paused' | 'playing' = 'none'
  session: SessionMetadata | undefined = undefined
  mediaId: number | undefined = undefined
  allowDiscordDetails = true

  constructor () {
    this.discord.on('ready', async () => {
      this.setDiscordRPC()
      this.discord.subscribe('ACTIVITY_JOIN_REQUEST', undefined)
      this.discord.subscribe('ACTIVITY_JOIN', undefined)
      this.discord.subscribe('ACTIVITY_SPECTATE', undefined)
    })

    // this.discord.on('ACTIVITY_JOIN', ({ secret }) => {
    //   window.webContents.send('w2glink', secret) // TODO
    // })

    this.loginRPC()
  }

  loginRPC () {
    this.discord.login().catch(() => {
      setTimeout(() => this.loginRPC(), 5000).unref()
    })
  }

  setDiscordRPC () {
    if (this.discord.user) {
      const position = (this.position?.position ?? 0) * 1000
      const duration = (this.position?.duration ?? 0) * 1000
      const status = {
        pid: process.pid,
        activity: {
          type: 3,
          name: 'Hayase',
          state: this.allowDiscordDetails ? this.session?.description ?? 'Streaming anime torrents! 🍿' : 'Streaming anime torrents! 🍿',
          details: this.allowDiscordDetails ? this.session?.title ?? 'Looking around...' : 'Looking around...',
          timestamps: {
            start: this.allowDiscordDetails && this.position ? Date.now() - position : undefined,
            end: this.allowDiscordDetails && this.position && this.playback === 'playing' ? Date.now() + (duration - position) : undefined
          },
          assets: {
            large_image: this.allowDiscordDetails && this.session?.image ? this.session.image : 'logo',
            large_text: 'https://hayase.watch'
          },
          buttons: [
            {
              label: 'Download app',
              url: 'https://hayase.watch/download'
            },
            {
              label: 'Watch on Hayase',
              url: 'hayase://anime/' + this.mediaId
            }
          ],
          party: {
            id: '1222'
          },
          instance: true
        }
      }
      this.discord.request('SET_ACTIVITY', status)
    }
  }
}
