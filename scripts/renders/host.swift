// An offline host of an Audio Unit: `host params` lists its parameters, `host state <out.bin>` writes its
// processor state (a magic, a JSON header, then a zstd frame of the CBOR of its modules; state.mjs),
// `host render <job.json> <out.f32>` renders a job: { rate, seconds, state?: "<a processor state>", params:
// { "<name>": value }, automation?: [{ name, points: [[seconds, value]] }], step?, notes: [{ note, on, off,
// velocity }] } into interleaved stereo float32: an automated parameter moves linearly between its points (before
// the first and after the last it holds them), set before each call of `step` samples (64 by default)
import AVFoundation
import AudioToolbox

func fourCC(_ s: String) -> OSType { s.utf8.reduce(0) { ($0 << 8) | OSType($1) } }

// the Audio Unit: RENDERS_AU of .env, the fourCCs of its component as <type>:<subtype>:<manufacturer>
let codes = (ProcessInfo.processInfo.environment["RENDERS_AU"] ?? "").split(separator: ":")
  .map { fourCC(String($0)) }
guard codes.count == 3 else { fatalError("RENDERS_AU is not <type>:<subtype>:<manufacturer>") }
let description = AudioComponentDescription(
  componentType: codes[0], componentSubType: codes[1], componentManufacturer: codes[2], componentFlags: 0,
  componentFlagsMask: 0)

// an automation at t seconds: linear between the points around it
func automated(_ points: [[Double]], _ t: Double) -> Double {
  guard let first = points.first, let last = points.last else { fatalError("an automation without points") }
  if t < first[0] { return first[1] }
  for i in 0..<(points.count - 1) where t >= points[i][0] && t < points[i + 1][0] {
    let share = (t - points[i][0]) / (points[i + 1][0] - points[i][0])
    return points[i][1] + (points[i + 1][1] - points[i][1]) * share
  }
  return last[1]
}

func instantiate() -> AVAudioUnit {
  var result: AVAudioUnit?
  var failure: Error?
  let done = DispatchSemaphore(value: 0)
  AVAudioUnit.instantiate(with: description, options: []) { unit, error in
    result = unit
    failure = error
    done.signal()
  }
  while done.wait(timeout: .now()) == .timedOut { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
  guard let unit = result else { fatalError("RENDERS_AU did not load: \(String(describing: failure))") }
  return unit
}

struct Note: Decodable { let note: UInt8; let on: Double; let off: Double; let velocity: UInt8? }
struct Automation: Decodable { let name: String; let points: [[Double]] }
struct Job: Decodable {
  let rate: Double
  let seconds: Double
  let state: String?
  let params: [String: Float]?
  let automation: [Automation]?
  let step: Int?
  let notes: [Note]
}

let args = CommandLine.arguments
let unit = instantiate()
let tree = unit.auAudioUnit.parameterTree?.allParameters ?? []

if args.count > 2 && args[1] == "display" {
  // host display <name> <normalized values...>: what the Audio Unit shows for each
  guard let p = tree.first(where: { $0.displayName == args[2] }) else { fatalError("no parameter \(args[2])") }
  for raw in args.dropFirst(3) {
    var v = AUValue(Float(raw)!)
    print("\(raw)\t\(p.string(fromValue: &v))")
  }
  exit(0)
}

if args.count > 1 && args[1] == "params" {
  for p in tree {
    print("\(p.address)\t\(p.displayName)\t\(p.minValue)..\(p.maxValue)\t\(p.value)\t\(p.unitName ?? "")")
  }
  exit(0)
}

if args.count > 2 && args[1] == "state" {
  guard let data = unit.auAudioUnit.fullState?["Processor State"] as? Data else { fatalError("no processor state") }
  try data.write(to: URL(fileURLWithPath: args[2]))
  exit(0)
}

guard args.count > 3, args[1] == "render" else {
  fatalError("usage: host params | host state <out.bin> | host render <job.json> <out.f32>")
}
let job = try JSONDecoder().decode(Job.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
if let path = job.state {
  // another patch: its processor state in place of the init one (its wavetable by the path in it)
  var state = unit.auAudioUnit.fullState ?? [:]
  state["Processor State"] = try Data(contentsOf: URL(fileURLWithPath: path))
  unit.auAudioUnit.fullState = state
}
let parameter = { (name: String) -> AUParameter in
  guard let p = tree.first(where: { $0.displayName == name }) else { fatalError("no parameter \(name)") }
  return p
}
for (name, value) in job.params ?? [:] { parameter(name).value = value }
let automations = (job.automation ?? []).map { (parameter($0.name), $0.points) }
let engine = AVAudioEngine()
let format = AVAudioFormat(standardFormatWithSampleRate: job.rate, channels: 2)!
engine.attach(unit)
engine.connect(unit, to: engine.mainMixerNode, format: format)
let block = AVAudioFrameCount(job.step ?? 64)
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: block)
try engine.start()
let instrument = unit as! AVAudioUnitMIDIInstrument
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: block)!
let total = Int(job.seconds * job.rate)
var out = [Float](repeating: 0, count: 2 * total)
var events: [(frame: Int, on: Bool, note: UInt8, velocity: UInt8)] = []
for n in job.notes {
  events.append((Int(n.on * job.rate), true, n.note, n.velocity ?? 100))
  events.append((Int(n.off * job.rate), false, n.note, 0))
}
events.sort { $0.frame < $1.frame }
var next = 0
var frame = 0
while frame < total {
  for (p, points) in automations { p.value = AUValue(automated(points, Double(frame) / job.rate)) }
  // the events of this block go at its start (a block of `step` samples: their times rounded down to it)
  while next < events.count && events[next].frame < frame + Int(block) {
    let e = events[next]
    if e.on { instrument.startNote(e.note, withVelocity: e.velocity, onChannel: 0) }
    else { instrument.stopNote(e.note, onChannel: 0) }
    next += 1
  }
  let frames = AVAudioFrameCount(min(Int(block), total - frame))
  let status = try engine.renderOffline(frames, to: buffer)
  guard status == .success else { fatalError("render: \(status.rawValue)") }
  let l = buffer.floatChannelData![0], r = buffer.floatChannelData![1]
  for i in 0..<Int(frames) {
    out[2 * (frame + i)] = l[i]
    out[2 * (frame + i) + 1] = r[i]
  }
  frame += Int(frames)
}
engine.stop()
try Data(bytes: out, count: out.count * 4).write(to: URL(fileURLWithPath: args[3]))
print("rendered \(total) frames")
