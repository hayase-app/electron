import cookie, { type SetCookie } from 'cookie'
import { session } from 'electron'

import type { OnBeforeSendHeadersListenerDetails } from 'electron'

let sess: SetCookie | undefined
let token: string | undefined

async function getCookie () {
  if (sess && token && sess.expires! >= new Date()) return { sess, token }

  const res = await fetch('https://anilist.co/')

  const cookieObj = cookie.parseSetCookie(res.headers.get('set-cookie') ?? '')

  const body = await res.text()

  token = /window\.al_token = "([^"]+)"/.exec(body)?.[1]

  if (!token || cookieObj.name !== 'laravel_session') throw new Error('Failed to retrieve token or session cookie')

  sess = cookieObj

  return { sess, token }
}

export async function rewriteInternalRequest (details: OnBeforeSendHeadersListenerDetails) {
  try {
    if (details.method !== 'POST') return
    const body = details.uploadData![0]!.bytes.toString()

    details.uploadData![0]!.bytes = Buffer.from(body.replace('\n', ','))

    delete details.requestHeaders.Authorization

    const [{ sess, token }, cookies] = await Promise.all([getCookie(), session.defaultSession.cookies.get({ url: 'https://anilist.co' })])

    details.requestHeaders.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ') || `${sess.name}=${sess.value}`
    details.requestHeaders['x-csrf-token'] = token
    details.requestHeaders.Referer = 'https://anilist.co/2e91b0aedee5a99abdc6.worker.js'
  } catch {
  }
}
