import { platform, arch } from 'node:process'

import { app } from 'electron'

import store from './store.ts'

const IS_LINUX = ['linux', 'freebsd', 'openbsd', 'netbsd', 'dragonfly', 'sunos'].includes(platform)

const flags: Array<[string, string | undefined]| [string]> = [
  // not sure if safe?
  ['disable-gpu-sandbox'], ['disable-direct-composition-video-overlays'], ['double-buffer-compositing'], ['enable-zero-copy'], ['ignore-gpu-blocklist'],
  ['force_high_performance_gpu'],
  // ['force-gpu-mem-available-mb=2048'],
  // should be safe
  ['enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay'],
  // safe performance and compatibility stuff
  ['enable-features', 'PlatformEncryptedDolbyVision,CanvasOopRasterization,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes,UseSkiaRenderer,WebAssemblyLazyCompilation,FluentOverlayScrollbar,FluentOverlayScrollbars,WindowsScrollingPersonality,AutoPictureInPictureForVideoPlayback' + (IS_LINUX ? ',Vulkan,VulkanFromANGLE' : '')],
  // disabling shit widget layering aka right click context menus [I think] for macOS [I think]
  ['disable-features', 'WidgetLayering'], // ,MediaEngagementBypassAutoplayPolicies,PreloadMediaEngagementData,RecordMediaEngagementScores might not be good,
  // utility stuff, aka website security that's useless for a native app:
  ['autoplay-policy', 'no-user-gesture-required'], ['disable-notifications'], ['disable-logging'], ['disable-permissions-api'], ['no-zygote'],
  // bypasses W3C API permissions which require visiblity to run, IE local fonts, this DOES NOT disable background throttling and thus doesnt break pause on lost visibility
  ['disable-renderer-backgrounding'],
  // chromium throttles stuff if it detects slow network, nono, this is native, dont do that
  ['force-effective-connection-type', '4G'],
  // image video etc cache, hopefully lets video buffer more and remembers more images, might be bad to touch this?
  ['disk-cache-size', '500000000'],
  // NodeJS security stuff, not supported yet
  ['disallow-code-generation-from-strings'], ['disable-proto', 'throw'], ['frozen-intrinsics'],
  ['js-flags', '--disallow-code-generation-from-strings --experimental-wasm-rab-integration'],
  // custom angle setting
  ['use-angle', store.get('angle') || 'default']
]

if (IS_LINUX || (platform === 'win32' && arch === 'arm64') || store.get('unsafeWebGPU')) {
  flags.push(['enable-unsafe-webgpu'])
}

for (const [flag, value] of flags) {
  app.commandLine.appendSwitch(flag, value)
}

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
