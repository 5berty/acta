import Foundation
import Testing
@testable import ActaMacCore

// Fixtures sintéticas con la forma de un árbol AX de Teams (web en WKWebView).
private func button(_ desc: String) -> AXNode { AXNode(role: "AXButton", desc: desc) }
private func text(_ v: String) -> AXNode { AXNode(role: "AXStaticText", value: v) }

private let meetingWindow = AXNode(role: "AXWindow", title: "Daily standup | Microsoft Teams", children: [
    AXNode(role: "AXGroup", children: [
        AXNode(role: "AXToolbar", children: [button("Mute (⌘+Shift+M)"), button("Camera"), button("Share"), button("Leave (⌘+Shift+H)")]),
        AXNode(role: "AXGroup", desc: "Ana García, speaking", children: [text("Ana García")]),
        AXNode(role: "AXGroup", desc: "Luis Pérez (Guest), Muted", children: [text("Luis Pérez")]),
        AXNode(role: "AXStaticText", value: "Ana García is presenting"),
    ]),
    AXNode(role: "AXGroup", desc: "Participants", children: [
        AXNode(role: "AXList", desc: "In this meeting (3)", children: [
            AXNode(role: "AXRow", children: [text("Edu Navajas (You)"), text("Organizer")]),
            AXNode(role: "AXRow", desc: "Ana García", children: [text("Ana García"), text("Unmuted")]),
            AXNode(role: "AXRow", children: [text("Luis Pérez (Guest)"), text("Muted")]),
        ]),
    ]),
])

private let chatWindow = AXNode(role: "AXWindow", title: "Chat | Microsoft Teams", children: [
    AXNode(role: "AXGroup", children: [button("New chat"), text("Hola!"), button("Meet now")]),
])

@Test func `meeting window is the one with call controls`() {
    #expect(TeamsAX.isMeetingWindow(meetingWindow))
    #expect(!TeamsAX.isMeetingWindow(chatWindow))
    let es = AXNode(role: "AXWindow", children: [button("Silenciar"), button("Cámara")])
    #expect(TeamsAX.isMeetingWindow(es), "Spanish UI without leave label but with two call controls")
    let salir = AXNode(role: "AXWindow", children: [button("Salir")])
    #expect(TeamsAX.isMeetingWindow(salir))
}

@Test func `roster comes from the participants list`() {
    let r = TeamsAX.roster(meetingWindow)
    #expect(r.map(\.name) == ["Edu Navajas", "Ana García", "Luis Pérez"])
    #expect(r[0].isSelf)
    #expect(r[1].muted == false)
    #expect(r[2].muted == true)
}

@Test func `active speaker is parsed in english and spanish`() {
    #expect(TeamsAX.activeSpeakers(meetingWindow) == ["Ana García"])
    let es = AXNode(role: "AXWindow", children: [AXNode(role: "AXGroup", desc: "Luis Pérez está hablando")])
    #expect(TeamsAX.activeSpeakers(es) == ["Luis Pérez"])
    #expect(TeamsAX.activeSpeakers(chatWindow).isEmpty)
}

@Test func `presenter detection`() {
    #expect(TeamsAX.presenter(meetingWindow)?.presenter == "Ana García")
    let me = AXNode(role: "AXWindow", children: [button("Stop presenting")])
    #expect(TeamsAX.presenter(me)?.presenter == "")
    let es = AXNode(role: "AXWindow", children: [text("Marta Ruiz está presentando")])
    #expect(TeamsAX.presenter(es)?.presenter == "Marta Ruiz")
    #expect(TeamsAX.presenter(chatWindow) == nil)
}

@Test func `full reading picks the meeting window among several`() {
    let r = TeamsAX.read(windows: [chatWindow, meetingWindow])
    #expect(r.isMeeting)
    #expect(r.meetingWindowTitle == "Daily standup | Microsoft Teams")
    #expect(r.activeSpeakers == ["Ana García"])
    #expect(r.sharing == true)
    #expect(r.roster.count == 3)
    let none = TeamsAX.read(windows: [chatWindow])
    #expect(!none.isMeeting && none.roster.isEmpty && none.activeSpeakers.isEmpty)
}

@Test func `names are cleaned and control labels rejected`() {
    #expect(TeamsAX.cleanName("Ana García (Guest), Muted") == "Ana García")
    #expect(TeamsAX.cleanName("Edu Navajas (You)") == "Edu Navajas")
    #expect(TeamsAX.cleanName("Leave") == nil)
    #expect(TeamsAX.cleanName("Participants") == nil)
    #expect(TeamsAX.cleanName("x") == nil)
}

@Test func `ax node round trips as json for calibration dumps`() throws {
    let data = try JSONEncoder().encode(meetingWindow)
    #expect(try JSONDecoder().decode(AXNode.self, from: data) == meetingWindow)
}
