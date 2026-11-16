// Acceso fino a la HAL de Core Audio (propiedades, dispositivos, procesos).
// Sin lógica: la lógica testeable vive en AudioMath / AppResolution.

import AppKit
import CoreAudio
import Foundation

struct CoreAudioError: Error, CustomStringConvertible {
    let status: OSStatus
    let what: String
    var description: String { "\(what) failed (OSStatus \(status) '\(fourCC(status))')" }
}

func fourCC(_ s: OSStatus) -> String {
    let n = UInt32(bitPattern: s)
    let chars = [24, 16, 8, 0].map { Character(UnicodeScalar(UInt8((n >> UInt32($0)) & 0xFF))) }
    return chars.allSatisfy { $0.isASCII && !$0.isWhitespace || $0 == " " } ? String(chars) : "\(s)"
}

@inline(__always)
func check(_ status: OSStatus, _ what: @autoclosure () -> String) throws {
    if status != noErr { throw CoreAudioError(status: status, what: what()) }
}

enum CA {
    static let system = AudioObjectID(kAudioObjectSystemObject)

    static func address(
        _ selector: AudioObjectPropertySelector,
        _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    static func has(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> Bool {
        var a = address(selector, scope)
        return AudioObjectHasProperty(id, &a)
    }

    static func get<T>(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, initial: T) throws -> T {
        var a = address(selector, scope)
        var value = initial
        var size = UInt32(MemoryLayout<T>.size)
        try check(AudioObjectGetPropertyData(id, &a, 0, nil, &size, &value), "get \(fourCC(OSStatus(bitPattern: selector)))")
        return value
    }

    static func getArray<T>(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, zero: T) throws -> [T] {
        var a = address(selector, scope)
        var size: UInt32 = 0
        try check(AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size), "size \(fourCC(OSStatus(bitPattern: selector)))")
        let count = Int(size) / MemoryLayout<T>.stride
        guard count > 0 else { return [] }
        var values = [T](repeating: zero, count: count)
        try values.withUnsafeMutableBytes { buf in
            try check(AudioObjectGetPropertyData(id, &a, 0, nil, &size, buf.baseAddress!), "get array")
        }
        return Array(values.prefix(Int(size) / MemoryLayout<T>.stride))
    }

    static func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> String? {
        var a = address(selector, scope)
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var value: Unmanaged<CFString>?
        let st = withUnsafeMutablePointer(to: &value) { ptr in
            AudioObjectGetPropertyData(id, &a, 0, nil, &size, ptr)
        }
        guard st == noErr, let v = value else { return nil }
        return v.takeRetainedValue() as String
    }

    // MARK: Dispositivos

    static func defaultDevice(input: Bool) -> AudioObjectID? {
        let sel = input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice
        guard let id = try? get(system, sel, initial: AudioObjectID(kAudioObjectUnknown)), id != kAudioObjectUnknown else { return nil }
        return id
    }

    static func allDevices() -> [AudioObjectID] {
        (try? getArray(system, kAudioHardwarePropertyDevices, zero: AudioObjectID(0))) ?? []
    }

    static func uid(_ id: AudioObjectID) -> String? { string(id, kAudioDevicePropertyDeviceUID) }
    static func name(_ id: AudioObjectID) -> String? { string(id, kAudioObjectPropertyName) }

    static func device(uid: String) -> AudioObjectID? {
        allDevices().first { self.uid($0) == uid }
    }

    static func channelCount(_ id: AudioObjectID, input: Bool) -> Int {
        let scope = input ? kAudioDevicePropertyScopeInput : kAudioDevicePropertyScopeOutput
        var a = address(kAudioDevicePropertyStreamConfiguration, scope)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr, size > 0 else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &a, 0, nil, &size, raw) == noErr else { return 0 }
        let abl = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return abl.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func nominalSampleRate(_ id: AudioObjectID) -> Double {
        (try? get(id, kAudioDevicePropertyNominalSampleRate, initial: Float64(0))) ?? 0
    }

    static func transport(_ id: AudioObjectID) -> String {
        let t = (try? get(id, kAudioDevicePropertyTransportType, initial: UInt32(0))) ?? 0
        switch t {
        case kAudioDeviceTransportTypeBuiltIn: return "builtin"
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
        case kAudioDeviceTransportTypeUSB: return "usb"
        case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate: return "virtual"
        default: return "other"
        }
    }

    static func isAlive(_ id: AudioObjectID) -> Bool {
        ((try? get(id, kAudioDevicePropertyDeviceIsAlive, initial: UInt32(0))) ?? 0) != 0
    }

    // MARK: Procesos (macOS 14+)

    static func processObjects() -> [AudioObjectID] {
        (try? getArray(system, kAudioHardwarePropertyProcessObjectList, zero: AudioObjectID(0))) ?? []
    }

    static func processObject(pid: pid_t) -> AudioObjectID? {
        var a = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
        var qualifier = pid
        var out = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let st = AudioObjectGetPropertyData(system, &a, UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &out)
        return st == noErr && out != kAudioObjectUnknown ? out : nil
    }

    static func audioProcess(_ obj: AudioObjectID) -> AudioProcessInfo? {
        guard let pid = try? get(obj, kAudioProcessPropertyPID, initial: pid_t(-1)), pid > 0 else { return nil }
        let bundle = string(obj, kAudioProcessPropertyBundleID) ?? ""
        let input = ((try? get(obj, kAudioProcessPropertyIsRunningInput, initial: UInt32(0))) ?? 0) != 0
        let output = ((try? get(obj, kAudioProcessPropertyIsRunningOutput, initial: UInt32(0))) ?? 0) != 0
        return AudioProcessInfo(objectId: obj, pid: pid, bundleId: bundle, runningInput: input, runningOutput: output)
    }

    static func audioProcesses() -> [AudioProcessInfo] {
        processObjects().compactMap(audioProcess)
    }
}

/// Un proceso que la HAL conoce (produce o consume audio).
struct AudioProcessInfo: Equatable, Sendable {
    var objectId: AudioObjectID
    var pid: pid_t
    var bundleId: String
    var runningInput: Bool
    var runningOutput: Bool
}

/// Escucha de una propiedad de la HAL. Se quita al soltarla.
final class PropertyListener: @unchecked Sendable {
    private let object: AudioObjectID
    private var addr: AudioObjectPropertyAddress
    private let queue: DispatchQueue
    private let block: AudioObjectPropertyListenerBlock

    init?(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, queue: DispatchQueue, _ handler: @escaping @Sendable () -> Void) {
        self.object = object
        addr = CA.address(selector, scope)
        self.queue = queue
        block = { _, _ in handler() }
        guard AudioObjectAddPropertyListenerBlock(object, &addr, queue, block) == noErr else { return nil }
    }

    deinit {
        AudioObjectRemovePropertyListenerBlock(object, &addr, queue, block)
    }
}

// MARK: - Apps dueñas de procesos de audio

/// Proceso "responsable" (la app que lanzó un helper/XPC). API privada pero
/// estable de libsystem (`responsibility_get_pid_responsible_for_pid`).
enum Responsibility {
    private typealias Fn = @convention(c) (pid_t) -> pid_t
    private static let fn: Fn? = {
        guard let h = dlopen(nil, RTLD_NOW), let sym = dlsym(h, "responsibility_get_pid_responsible_for_pid") else { return nil }
        return unsafeBitCast(sym, to: Fn.self)
    }()

    static func responsiblePid(_ pid: pid_t) -> pid_t? {
        guard let fn else { return nil }
        let r = fn(pid)
        return r > 0 ? r : nil
    }
}

enum RunningApps {
    static func bundleId(pid: pid_t) -> String? {
        NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
    }

    static func name(pid: pid_t) -> String? {
        NSRunningApplication(processIdentifier: pid)?.localizedName
    }

    static func mainPid(bundleId: String) -> pid_t? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .first { !$0.isTerminated }?.processIdentifier
    }
}
