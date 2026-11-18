import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Param, Post, Query, Res, Sse } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { endWith, interval, map, merge, type Observable, startWith, takeWhile } from "rxjs";
import { Sessions } from "@open-qa-stack/engine";
import { eventIdOf } from "./event-id.ts";
import { EventStreams } from "./event-streams.ts";
import { SessionMessagePipe } from "./session-message.pipe.ts";
import { SessionOpeningPipe } from "./session-opening.pipe.ts";
import { StreamPace } from "./stream-pace.ts";
import type { MessageEvent } from "@nestjs/common";
import type { MessageReceipt, Session, SessionList, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";

/**
 * `GET /sessions`, `GET /sessions/:id`, `GET /sessions/:id/events`, `POST /sessions`, `POST /sessions/:id/messages`,
 * `POST /sessions/:id/resumption` and `POST /sessions/:id/interruption`: each route is one operation on the
 * sessions, said in HTTP.
 */
@Controller("sessions")
export class SessionsController {
  readonly #sessions: Sessions;
  readonly #streams: EventStreams;
  readonly #pace: StreamPace;
  readonly #adapterHost: HttpAdapterHost;

  constructor(sessions: Sessions, streams: EventStreams, pace: StreamPace, adapterHost: HttpAdapterHost) {
    this.#sessions = sessions;
    this.#streams = streams;
    this.#pace = pace;
    this.#adapterHost = adapterHost;
  }

  /** @returns Every session, the latest first, which no cache may keep: sessions change while they run. */
  @Get()
  @Header("Cache-Control", "no-store")
  async list(): Promise<SessionList> {
    return { items: await this.#sessions.sessions() };
  }

  /** @returns The session as it is now; an unknown one is answered with `404`. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  one(@Param("id") id: string): Promise<Session> {
    return this.#sessions.session(id);
  }

  /**
   * Streams the events of a session as server-sent events.
   *
   * @remarks
   * The stream opens on a message without data that bears the identifier it resumes after and the time to
   * wait before reconnecting: a client that named that identifier in the address then resumes from the right
   * event by itself. Each event follows under its identifier. A comment is sent at each heartbeat, which
   * keeps the proxies on the way from cutting a stream that has nothing to say. The stream ends when the
   * events do.
   *
   * @param id - The identifier of the session.
   * @param lastEventId - The `Last-Event-ID` header: the last event a client that reconnects got.
   * @param after - The `after` parameter of the address: the same, for a client that cannot set the header; the header wins.
   * @returns The messages of the stream; an unknown session is answered with `404`, an identifier of event that is none with `400`.
   */
  @Sse(":id/events")
  async events(@Param("id") id: string, @Headers("last-event-id") lastEventId: unknown, @Query("after") after: unknown): Promise<Observable<MessageEvent>> {
    const known = eventIdOf("Last-Event-ID", lastEventId) ?? eventIdOf("after", after) ?? 0;
    const events = this.#streams.of(id, await this.#sessions.events(id, known));
    const messages = events.pipe(
      map((event): MessageEvent => ({ id: String(event.id), data: event })),
      startWith<MessageEvent>({ id: String(known), retry: this.#pace.retryMs }),
      endWith(undefined),
    );
    const heartbeats = interval(this.#pace.heartbeatMs).pipe(map((): MessageEvent => ({ comment: "heartbeat" })));
    return merge(messages, heartbeats).pipe(takeWhile((message): message is MessageEvent => message !== undefined));
  }

  /**
   * @returns The session opened, `running` when it started at once and `queued` when it waits its turn,
   * answered with `201` and, as `Location`, where to read it: a reference relative to the address of the
   * request, which holds behind a proxy that serves the API under a prefix. An API that was given no test
   * repository answers `503`.
   */
  @Post()
  async open(@Body(SessionOpeningPipe) opening: SessionOpening, @Res({ passthrough: true }) response: unknown): Promise<Session> {
    const session = await this.#sessions.open(opening);
    this.#adapterHost.httpAdapter.setHeader(response, "Location", `sessions/${encodeURIComponent(session.id)}`);
    return session;
  }

  /**
   * @returns The receipt of the message, answered with `202`: the message is taken, and the stream of the
   * events tells later the agent it reached. An unknown session is answered with `404`, one that no longer
   * goes on with `409`.
   */
  @Post(":id/messages")
  @HttpCode(HttpStatus.ACCEPTED)
  send(@Param("id") id: string, @Body(SessionMessagePipe) message: SessionMessage): Promise<MessageReceipt> {
    return this.#sessions.say(id, message);
  }

  /**
   * Resumes a session that ended with what the person says more to it, which starts a new turn of its work.
   *
   * @returns The session, answered with `202`: `running` when its turn started at once, `queued` when it waits;
   * its stream tells the turn from the message on. An unknown session is answered with `404`, one that goes on
   * with `409`: it takes a message instead. An API that was given no test repository answers `503`.
   */
  @Post(":id/resumption")
  @HttpCode(HttpStatus.ACCEPTED)
  resume(@Param("id") id: string, @Body(SessionMessagePipe) message: SessionMessage): Promise<Session> {
    return this.#sessions.resume(id, message);
  }

  /**
   * Interrupts a session that goes on, answered with `202`: one that waits is interrupted at once, one that
   * runs is asked to stop, and the stream of the events tells when it did. An unknown session is answered
   * with `404`, one that had already ended with `409`.
   */
  @Post(":id/interruption")
  @HttpCode(HttpStatus.ACCEPTED)
  interrupt(@Param("id") id: string): Promise<void> {
    return this.#sessions.interrupt(id);
  }
}
