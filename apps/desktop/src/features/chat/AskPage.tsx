import { ChatContainer } from "./ChatContainer";

const SUGGESTIONS = [
  "¿Qué tareas tengo pendientes esta semana?",
  "¿Qué decisiones tomamos sobre el presupuesto?",
  "Resume lo último que hablé con el equipo",
  "¿Quién se comprometió a qué?",
];

/** «Preguntar»: un chat sobre todas las reuniones a la vez. */
export function AskPage({ onOpenMeeting }: { onOpenMeeting(id: string, at?: number): void }) {
  return (
    <div className="page ask-page">
      <header className="page-head">
        <div className="page-title">
          <h1>Preguntar</h1>
        </div>
        <p className="page-sub">Pregunta a todas tus reuniones a la vez. acta busca en los transcripts y te responde con citas.</p>
      </header>
      <div className="page-body">
        <ChatContainer scope={{ kind: "all" }} placeholder="todas tus reuniones" suggestions={SUGGESTIONS} onCitation={(c) => onOpenMeeting(c.meetingId, c.at)} />
      </div>
    </div>
  );
}
