import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Game, type PromotionPiece, type Square } from "../game/game.ts";
import { HumanPlayer, type MoveRequest } from "../game/player.ts";
import { createLineup, type GameSetup } from "../game/setup.ts";
import { Board, fitCellHeight, type PieceStyle } from "./board.tsx";
import { type Action, keyToAction } from "./keys.ts";
import { PromotionPicker } from "./promotion.tsx";
import { Sidebar } from "./sidebar.tsx";
import { moveSquare } from "./squares.ts";

export interface GameScreenProps {
  setup: GameSetup;
  onMenu: () => void;
  onQuit: () => void;
  botThinkMs?: number;
}

export function GameScreen(props: GameScreenProps) {
  const game = new Game();
  const { players, humanColor } = createLineup(props.setup, Math.random, props.botThinkMs);
  const playerNames = { w: players.w.name, b: players.b.name };

  const [snapshot, setSnapshot] = createSignal(game.snapshot());
  const [cursor, setCursor] = createSignal<Square>(humanColor === "w" ? "e2" : "e7");
  const [selected, setSelected] = createSignal<Square | null>(null);
  const [flipped, setFlipped] = createSignal(humanColor === "b");
  const [pieceStyle, setPieceStyle] = createSignal<PieceStyle>("art");
  const [pendingPromotion, setPendingPromotion] = createSignal<{ from: Square; to: Square } | null>(
    null,
  );
  const [message, setMessage] = createSignal<string | null>(null);
  const [thinking, setThinking] = createSignal<string | null>(null);

  const dimensions = useTerminalDimensions();
  const cellHeight = () => fitCellHeight(dimensions().width, dimensions().height);

  let moves: ScrollBoxRenderable | undefined;

  const targets = createMemo(() => {
    snapshot();
    const from = selected();
    return from ? game.legalTargets(from) : [];
  });

  let turn: AbortController | null = null;

  const refresh = () => {
    setSnapshot(game.snapshot());
    setSelected(null);
    setPendingPromotion(null);
  };

  const startTurn = () => {
    turn?.abort();
    setThinking(null);
    if (game.isOver()) return;
    const controller = new AbortController();
    turn = controller;
    const player = players[game.turn()];
    if (player.kind !== "human") setThinking(`${player.name} is thinking...`);
    player
      .requestMove(game, controller.signal)
      .then((request) => {
        if (controller.signal.aborted) return;
        if (!game.move(request.from, request.to, request.promotion)) setMessage("Illegal move.");
        refresh();
        startTurn();
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setThinking(null);
        setMessage(error instanceof Error ? error.message : "The bot failed to move.");
      });
  };

  const humanToMove = () => players[game.turn()] instanceof HumanPlayer;

  const submit = (request: MoveRequest) => {
    const player = players[game.turn()];
    if (player instanceof HumanPlayer) player.submit(request);
  };

  const select = () => {
    if (game.isOver() || !humanToMove()) return;
    const square = cursor();
    const from = selected();
    if (from && targets().includes(square)) {
      if (game.needsPromotion(from, square)) setPendingPromotion({ from, to: square });
      else submit({ from, to: square });
      return;
    }
    const piece = game.pieceAt(square);
    setSelected(piece && piece.color === game.turn() && square !== from ? square : null);
  };

  const promote = (piece: PromotionPiece) => {
    const pending = pendingPromotion();
    if (pending) submit({ ...pending, promotion: piece });
  };

  const restart = (mutate: () => void) => {
    turn?.abort();
    mutate();
    refresh();
    startTurn();
  };

  const undo = () => {
    game.undo();
    while (!humanToMove() && game.history().length > 0) game.undo();
  };

  const handle = (action: Action) => {
    setMessage(null);
    switch (action.type) {
      case "cursor":
        setCursor((c) => moveSquare(c, action.dx, action.dy, flipped()));
        break;
      case "select":
        select();
        break;
      case "cancel":
        setPendingPromotion(null);
        setSelected(null);
        break;
      case "promote":
        promote(action.piece);
        break;
      case "undo":
        if (snapshot().history.length === 0) setMessage("Nothing to undo.");
        else restart(undo);
        break;
      case "flip":
        setFlipped((f) => !f);
        break;
      case "pieceStyle":
        setPieceStyle((s) => (s === "art" ? "glyph" : "art"));
        break;
      case "scroll":
        moves?.scrollBy(action.delta);
        break;
      case "new":
        restart(() => game.reset());
        break;
      case "menu":
        props.onMenu();
        break;
      case "quit":
        props.onQuit();
        break;
    }
  };

  useKeyboard((key) => {
    const action = keyToAction(key, pendingPromotion() ? "promotion" : "board");
    if (action) handle(action);
  });

  startTurn();
  onCleanup(() => turn?.abort());

  return (
    <box flexDirection="row" width="100%" height="100%" padding={1}>
      <Board
        snapshot={snapshot()}
        cursor={cursor()}
        selected={selected()}
        targets={targets()}
        flipped={flipped()}
        cellHeight={cellHeight()}
        pieceStyle={pieceStyle()}
      />
      <box flexDirection="column" paddingLeft={2} gap={1}>
        <Show when={pendingPromotion()}>
          <PromotionPicker />
        </Show>
        <Sidebar
          snapshot={snapshot()}
          message={message()}
          playerNames={playerNames}
          thinking={thinking()}
          movesRef={(el) => {
            moves = el;
          }}
        />
      </box>
    </box>
  );
}
