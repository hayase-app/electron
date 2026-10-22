import { stderr, stdout } from 'node:process'

import type { WriteStream } from 'node:tty'

// A packaged app can start with a closed stdout/stderr pipe.
// A write to a closed pipe gives EPIPE and stops the main process.
// electron-log also writes the message to a file, so ignore only EPIPE.
function ignoreEpipe (stream: WriteStream | undefined) {
  stream?.on('error', (error: Error & { code?: string }) => {
    if (error.code !== 'EPIPE') throw error
  })
}

ignoreEpipe(stdout)
ignoreEpipe(stderr)
