import type { BotLevel } from "../engine/bot.ts";
import type { Game, PromotionPiece, Square } from "./game.ts";

export type PlayerKind = "human" | "bot" | "llm" | "engine";

export interface MoveRequest {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export interface Player {
  readonly kind: PlayerKind;
  readonly name: string;
  requestMove(game: Game, signal?: AbortSignal): Promise<MoveRequest>;
}

export class HumanPlayer implements Player {
  readonly kind = "human";
  private resolvePending: ((move: MoveRequest) => void) | null = null;

  constructor(readonly name: string) {}

  requestMove(_game: Game, signal?: AbortSignal): Promise<MoveRequest> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.resolvePending = null;
        reject(signal?.reason);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.resolvePending = (move) => {
        signal?.removeEventListener("abort", onAbort);
        this.resolvePending = null;
        resolve(move);
      };
    });
  }

  isWaiting(): boolean {
    return this.resolvePending !== null;
  }

  submit(move: MoveRequest): boolean {
    if (!this.resolvePending) return false;
    this.resolvePending(move);
    return true;
  }
}

export class BotPlayer implements Player {
  readonly kind = "bot";
  readonly name: string;

  constructor(
    readonly level: BotLevel,
    private readonly minThinkMs = 400,
  ) {
    this.name = `Bot (${level})`;
  }

  requestMove(game: Game, signal?: AbortSignal): Promise<MoveRequest> {
    const fen = game.fen();
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("../engine/bot-worker.ts", import.meta.url));
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        clearTimeout(timer);
        worker.terminate();
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        stop();
        reject(signal?.reason);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.onmessage = (event: MessageEvent<MoveRequest>) => {
        timer = setTimeout(
          () => {
            stop();
            resolve(event.data);
          },
          Math.max(0, this.minThinkMs - (Date.now() - started)),
        );
      };
      worker.onerror = (event) => {
        stop();
        reject(event.error ?? new Error(event.message));
      };
      worker.postMessage({ fen, level: this.level });
    });
  }
}
