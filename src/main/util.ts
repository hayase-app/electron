import { app } from 'electron'

import store from './store.ts'

const flags: Array<[string, string | undefined]| [string]> = [
  // not sure if safe?
  ['disable-gpu-sandbox'], ['disable-direct-composition-video-overlays'], ['double-buffer-compositing'], ['enable-zero-copy'], ['ignore-gpu-blocklist'],
  ['force_high_performance_gpu'],
  // ['force-gpu-mem-available-mb=2048'],
  // should be safe
  ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
  // safe performance stuff
  ['enable-features', 'PlatformEncryptedDolbyVision,CanvasOopRasterization,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,UseSkiaRenderer,WebAssemblyLazyCompilation,FluentOverlayScrollbar,WindowsScrollingPersonality,AutoPictureInPictureForVideoPlayback'],
  // disabling shit, vulkan rendering, widget layering aka right click context menus [I think] for macOS [I think]
  ['disable-features', 'Vulkan,WidgetLayering'], // ,MediaEngagementBypassAutoplayPolicies,PreloadMediaEngagementData,RecordMediaEngagementScores might not be good
  // utility stuff, aka website security that's useless for a native app:
  ['autoplay-policy', 'no-user-gesture-required'], ['disable-notifications'], ['disable-logging'], ['disable-permissions-api'], ['no-zygote'],
  // bypasses W3C API permissions which require visiblity to run, IE local fonts, this DOES NOT disable background throttling and thus doesnt break pause on lost visibility
  ['disable-renderer-backgrounding'],
  // chromium throttles stuff if it detects slow network, nono, this is native, dont do that
  ['force-effective-connection-type', '4G'],
  // image video etc cache, hopefully lets video buffer more and remembers more images, might be bad to touch this?
  ['disk-cache-size', '500000000']
]
for (const [flag, value] of flags) {
  app.commandLine.appendSwitch(flag, value)
}

app.commandLine.appendSwitch('use-angle', store.get('angle') || 'default')

// mainWindow.setThumbarButtons([
//   {
//     tooltip: 'button1',
//     icon: nativeImage.createFromPath('path'),
//     click () { console.log('button1 clicked') }
//   }, {
//     tooltip: 'button2',
//     icon: nativeImage.createFromPath('path'),
//     click () { console.log('button2 clicked.') }
//   }
// ])
