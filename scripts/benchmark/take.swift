// Plays the benchmark's one take: opens scene.html in a 1440 × 900 window and, after a wait to start a recorder,
// moves the real pointer, clicks, types, and scrolls on it, the same way at the same times in every run. The events
// go through macOS, so any recorder sees them as it sees a person's. Record the window "Acme deployments".
// Run: swift scripts/benchmark/take.swift [seconds to wait, default 8]   (the terminal needs Accessibility)
import AppKit
import WebKit

guard AXIsProcessTrusted() else {
  FileHandle.standardError.write(Data("Allow this terminal under System Settings > Privacy & Security > Accessibility, then run again.\n".utf8))
  exit(1)
}
let wait = CommandLine.arguments.count > 1 ? Double(CommandLine.arguments[1]) ?? 8 : 8

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled], backing: .buffered, defer: false)
let web = WKWebView(frame: window.contentLayoutRect)
window.title = "Acme deployments"
window.contentView = web
window.center()
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
let scene = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("scene.html")
web.loadFileURL(scene, allowingReadAccessTo: scene.deletingLastPathComponent())

typealias Pt = CGPoint
func rest(_ s: Double) { usleep(UInt32(s * 1_000_000)) }
@Sendable func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
@Sendable func mouse(_ type: CGEventType, _ at: Pt) { post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: .left)) }
var at = Pt.zero

/// The centre of the first visible match of `css`, in screen points from the top left.
func centre(_ css: String) -> Pt {
  var p = Pt.zero
  let done = DispatchSemaphore(value: 0)
  DispatchQueue.main.async {
    let js = "(() => { const r = [...document.querySelectorAll('\(css)')].find((e) => e.offsetParent).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()"
    web.evaluateJavaScript(js) { value, _ in
      guard let xy = value as? [Double], let screen = NSScreen.screens.first else { fatalError("The scene has no \(css).") }
      let content = window.contentRect(forFrameRect: window.frame)
      p = Pt(x: content.minX + xy[0], y: screen.frame.height - content.maxY + xy[1])
      done.signal()
    }
  }
  done.wait()
  return p
}

/// Moves the pointer to `to` over `s` seconds at 120 Hz, eased in and out on a slight arc like a hand
/// (`smooth` and `glide` in src/shared/demo.ts).
func move(_ to: Pt, _ s: Double) {
  let from = at
  let n = Int(s * 120)
  for k in 1...n {
    let t = Double(k) / Double(n)
    let p = t * t * t * (t * (6 * t - 15) + 10)
    let bow = sin(Double.pi * p) * 0.05
    at = Pt(x: from.x + (to.x - from.x) * p - (to.y - from.y) * bow, y: from.y + (to.y - from.y) * p + (to.x - from.x) * bow)
    mouse(.mouseMoved, at)
    rest(1.0 / 120)
  }
}

func click() {
  mouse(.leftMouseDown, at)
  rest(0.1)
  mouse(.leftMouseUp, at)
}

/// Types `text` at 8 characters a second. Each event carries its US key code, for a recorder that shows keys, and
/// its character, so the page gets the same text under any keyboard layout.
func type(_ text: String) {
  let codes: [Character: CGKeyCode] = ["c": 8, "h": 4, "e": 14, "k": 40, "o": 31, "u": 32, "t": 17]
  for ch in text {
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: nil, virtualKey: codes[ch]!, keyDown: down)
      let unit = Array(String(ch).utf16)
      e?.keyboardSetUnicodeString(stringLength: unit.count, unicodeString: unit)
      post(e)
      rest(down ? 0.05 : 0.075)
    }
  }
}

func scroll(_ px: Int32, _ s: Double) {
  for _ in 0..<30 {
    post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -px / 30, wheel2: 0, wheel3: 0))
    rest(s / 30)
  }
}

Thread.detachNewThread {
  print("Start the recorder on the window. The take starts in \(Int(wait)) s and runs for 15 s.")
  rest(wait)
  DispatchQueue.main.sync { app.activate(ignoringOtherApps: true) }
  at = CGEvent(source: nil)!.location
  move(centre("h1"), 0.8); rest(0.6)
  move(centre("#deploy"), 0.9); click(); rest(2.4) // the build runs for 1.8 s
  move(centre("#search"), 0.8); click(); rest(0.3)
  type("checkout"); rest(0.8)
  move(centre(".row:not([hidden])"), 0.7); click(); rest(0.7)
  move(centre("#log"), 0.5); scroll(900, 1.5); rest(1.0)
  move(centre("#close"), 0.6); click(); rest(0.5)
  move(centre(".row:not([hidden]) .when"), 0.35); rest(1.2) // a fast move, for the cursor's smoothing
  print("Done. Stop the recorder.")
  rest(2)
  exit(0)
}
app.run()
