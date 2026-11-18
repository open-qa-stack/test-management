/**
 * Why a command on a session is refused: `unknown_session` when there is no such session, `session_ended` when
 * the session is completed or interrupted and the command is not for an end, `wrong_state` when the session
 * goes on in a state the command is not for — it still waits, runs already, or goes on while it is resumed —
 * and `message_not_pending` when the message to deliver is not held by the session, or was received already.
 */
export type SessionRefusal = "unknown_session" | "session_ended" | "wrong_state" | "message_not_pending";
