"use client";

export interface ConversationMessageProps {
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  optimistic?: boolean;
}

/**
 * Renders a single conversational turn while keeping user-provided context
 * ("You told Ano") visually distinct from Ano's assistant messages.
 */
export function ConversationMessage({
  role,
  text,
  createdAt,
  optimistic = false,
}: ConversationMessageProps) {
  return (
    <article className={`m3-message-row role-${role}${optimistic ? " is-optimistic" : ""}`}>
      <div className="m3-message-bubble">
        <header className="m3-message-meta">
          <strong>{role === "assistant" ? "Ano" : "You told Ano"}</strong>
          {optimistic ? (
            <span className="m3-optimistic-tag">Sending…</span>
          ) : createdAt ? (
            <time>
              {new Date(createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          ) : null}
        </header>
        <p>{text}</p>
      </div>
    </article>
  );
}
