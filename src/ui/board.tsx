import { TextAttributes } from "@opentui/core";
import { For, Index } from "solid-js";
import type { BoardPiece, GameSnapshot, PieceSymbol, Square } from "../game/game.ts";
import { FILES, toSquare } from "./squares.ts";
import { theme } from "./theme.ts";

const GLYPHS: Record<PieceSymbol, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const ART: Record<PieceSymbol, [string, string, string]> = {
  k: [" _+_ ", " )_( ", "(___)"],
  q: [" www ", " )_( ", "(___)"],
  r: ["|_|_|", " | | ", "(___)"],
  b: ["  o  ", " (/) ", "(___)"],
  n: [" _/| ", "/ o )", "(___)"],
  p: ["     ", "  o  ", " (_) "],
};

export type PieceStyle = "art" | "glyph";

export const MAX_CELL_HEIGHT = 5;
export const BOARD_SIDE_WIDTH = 32;

export function cellWidthFor(cellHeight: number): number {
  return cellHeight * 2 + 1;
}

export function fitCellHeight(width: number, height: number): number {
  for (let h = MAX_CELL_HEIGHT; h > 1; h--) {
    const fitsHeight = 8 * h + 1 <= height - 2;
    const fitsWidth = 2 + 8 * cellWidthFor(h) + BOARD_SIDE_WIDTH <= width - 2;
    if (fitsHeight && fitsWidth) return h;
  }
  return 1;
}

export function canDrawArt(cellHeight: number): boolean {
  return cellHeight >= 3;
}

export interface BoardProps {
  snapshot: GameSnapshot;
  cursor: Square;
  selected: Square | null;
  targets: Square[];
  flipped: boolean;
  cellHeight: number;
  pieceStyle: PieceStyle;
}

const INDICES = [0, 1, 2, 3, 4, 5, 6, 7];

export function Board(props: BoardProps) {
  const cellWidth = () => cellWidthFor(props.cellHeight);
  const lines = () => Array.from({ length: props.cellHeight }, (_, i) => i);
  const middle = () => Math.floor(props.cellHeight / 2);
  const useArt = () => props.pieceStyle === "art" && canDrawArt(props.cellHeight);
  const pad = (text: string) => {
    const left = Math.floor((cellWidth() - text.length) / 2);
    return " ".repeat(left) + text + " ".repeat(cellWidth() - text.length - left);
  };

  const rankAt = (row: number) => (props.flipped ? row : 7 - row);
  const fileAt = (col: number) => (props.flipped ? 7 - col : col);

  const pieceAt = (file: number, rank: number): BoardPiece | null =>
    props.snapshot.board[7 - rank]?.[file] ?? null;

  const background = (square: Square, file: number, rank: number, piece: BoardPiece | null) => {
    const light = (file + rank) % 2 === 1;
    if (square === props.cursor) return theme.cursor;
    if (square === props.selected) return theme.selected;
    if (piece && props.targets.includes(square)) return theme.capture;
    const last = props.snapshot.lastMove;
    if (last && (last.from === square || last.to === square)) {
      return light ? theme.lastMoveLight : theme.lastMoveDark;
    }
    return light ? theme.lightSquare : theme.darkSquare;
  };

  const cell = (square: Square, piece: BoardPiece | null, line: number) => {
    if (piece && useArt()) {
      const artLine = line - (middle() - 1);
      return pad(ART[piece.type][artLine] ?? "");
    }
    if (line !== middle()) return pad("");
    const center = piece ? GLYPHS[piece.type] : props.targets.includes(square) ? "•" : " ";
    return pad(square === props.cursor && !useArt() ? `[${center}]` : center);
  };

  const foreground = (piece: BoardPiece | null) =>
    piece ? (piece.color === "w" ? theme.whitePiece : theme.blackPiece) : theme.hint;

  return (
    <box flexDirection="column">
      <For each={INDICES}>
        {(row) => (
          <Index each={lines()}>
            {(line) => (
              <text>
                <span style={{ fg: theme.label }}>
                  {line() === middle() ? `${rankAt(row) + 1} ` : "  "}
                </span>
                <For each={INDICES}>
                  {(col) => {
                    const file = () => fileAt(col);
                    const rank = () => rankAt(row);
                    const square = () => toSquare(file(), rank());
                    const piece = () => pieceAt(file(), rank());
                    return (
                      <span
                        style={{
                          fg: foreground(piece()),
                          bg: background(square(), file(), rank(), piece()),
                          attributes: TextAttributes.BOLD,
                        }}
                      >
                        {cell(square(), piece(), line())}
                      </span>
                    );
                  }}
                </For>
              </text>
            )}
          </Index>
        )}
      </For>
      <text>
        <span style={{ fg: theme.label }}>
          {`  ${INDICES.map((col) => pad(FILES[fileAt(col)] ?? "")).join("")}`}
        </span>
      </text>
    </box>
  );
}
