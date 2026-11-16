// @testable: los init memberwise de Protocol.swift son internal (ver petición
// de cambio de contrato de WP4: añadir init públicos).
@testable import ActaMacProtocol
import Foundation
import Testing

@Test func `decodes a command with snake_case args`() throws {
    let line = #"{"id":7,"cmd":"capture.retarget","args":{"pids":[1,2],"bundle_ids":["com.microsoft.teams2"]}}"#
    let req = try ProtocolCoding.decoder().decode(Request.self, from: Data(line.utf8))
    #expect(req == Request(id: 7, command: .captureRetarget(.init(pids: [1, 2], bundleIds: ["com.microsoft.teams2"]))))
}

@Test func `decodes a command without args`() throws {
    let req = try ProtocolCoding.decoder().decode(Request.self, from: Data(#"{"id":1,"cmd":"capture.stop"}"#.utf8))
    #expect(req.command == .captureStop)
}

@Test func `unknown command keeps the id for the error reply`() {
    #expect(throws: RequestDecodingError.unknownCommand(id: 9, cmd: "nope")) {
        try ProtocolCoding.decoder().decode(Request.self, from: Data(#"{"id":9,"cmd":"nope"}"#.utf8))
    }
}

@Test func `encodes an event line like the Rust side expects`() throws {
    let frame = AudioFrameEvent(track: .system, seq: 42, ptsUs: 4_200_000, sampleRate: 16_000, channels: 1, format: "s16le", data: "AAA=")
    let data = try ProtocolCoding.encoder().encode(EventLine(ts: 1, event: .audioFrame(frame)))
    let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(json["type"] as? String == "event")
    #expect(json["event"] as? String == "audio.frame")
    let payload = try #require(json["data"] as? [String: Any])
    #expect(payload["pts_us"] as? Int == 4_200_000)
    #expect(payload["sample_rate"] as? Int == 16_000)
}
