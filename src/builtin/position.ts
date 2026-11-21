// The engine that ships inside the package: no dependency, no copied tables, MIT
// clean. A 0x88 board (128 cells; a square is real when (sq & 0x88) === 0) with
// signed pieces, +1..+6 white pawn..king and -6..-1 black.
//
// Move generation is pseudo-legal followed by a make/test/unmake, which is slower
// than pin detection but has one large advantage: "legal" is defined by actually
// playing the move, so a missing pin cannot hide. The perft suite pins it down.

export type Color = 1 | -1;
export type Move = number;

export const WHITE: Color = 1;
export const BLACK: Color = -1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// move packing: from 0..6, to 7..13, promotion 14..16, flag 17..20
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;

export const mkMove = (from: number, to: number, promo = 0, flag = 0): Move =>
  from | (to << 7) | (promo << 14) | (flag << 17);
export const fromOf = (m: Move): number => m & 0x7f;
export const toOf = (m: Move): number => (m >>> 7) & 0x7f;
export const promoOf = (m: Move): number => (m >>> 14) & 0x7;
export const flagOf = (m: Move): number => (m >>> 17) & 0xf;

export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >>> 4;
export const sqName = (sq: number): string => `${"abcdefgh"[fileOf(sq)] ?? "?"}${rankOf(sq) + 1}`;

export const parseSq = (name: string): number => {
  const file = "abcdefgh".indexOf(name[0] ?? "");
  const rank = Number(name[1]) - 1;
  if (file < 0 || !Number.isInteger(rank) || rank < 0 || rank > 7) throw new Error(`not a square: ${name}`);
  return file | (rank << 4);
};

export const PROMO_LETTER: Record<number, string> = { [KNIGHT]: "n", [BISHOP]: "b", [ROOK]: "r", [QUEEN]: "q" };

/** UCI move text, which is what a Candidate carries. */
export const moveToUci = (m: Move): string => {
  const promo = promoOf(m);
  return `${sqName(fromOf(m))}${sqName(toOf(m))}${promo ? (PROMO_LETTER[promo] ?? "") : ""}`;
};

const KNIGHT_D = [33, 31, 18, 14, -14, -18, -31, -33];
const BISHOP_D = [17, 15, -15, -17];
const ROOK_D = [16, 1, -1, -16];
const KING_D = [17, 16, 15, 1, -1, -15, -16, -17];

const PIECE_OF: Record<string, number> = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
const LETTER_OF = ["", "p", "n", "b", "r", "q", "k"];

const MAX_PLY = 2048;

export class Position {
  board = new Int8Array(128);
  side: Color = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  /** king squares, [white, black]; kept in sync by make/unmake */
  kings: [number, number] = [-1, -1];

  // Undo state as parallel arrays: one allocation per move is exactly the sort of
  // thing that makes a search 30% slower for no benefit.
  private uCastling = new Int32Array(MAX_PLY);
  private uEp = new Int32Array(MAX_PLY);
  private uHalfmove = new Int32Array(MAX_PLY);
  private uFullmove = new Int32Array(MAX_PLY);
  private uCaptured = new Int32Array(MAX_PLY);
  private uCapturedSq = new Int32Array(MAX_PLY);
  private uKingW = new Int32Array(MAX_PLY);
  private uKingB = new Int32Array(MAX_PLY);
  private ply = 0;

  static fromFen(fen: string): Position {
    const pos = new Position();
    pos.loadFen(fen);
    return pos;
  }

  loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    const [placement, side, castling, ep] = parts;
    if (!placement) throw new Error(`not a FEN: ${fen}`);
    this.board.fill(0);
    this.kings = [-1, -1];
    let rank = 7;
    let file = 0;
    for (const ch of placement) {
      if (ch === "/") {
        rank--;
        file = 0;
      } else if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        const type = PIECE_OF[ch.toLowerCase()];
        if (!type || rank < 0 || file > 7) throw new Error(`not a FEN: ${fen}`);
        const sq = file | (rank << 4);
        this.board[sq] = ch === ch.toUpperCase() ? type : -type;
        if (type === KING) this.kings[ch === ch.toUpperCase() ? 0 : 1] = sq;
        file++;
      }
    }
    this.side = side === "b" ? BLACK : WHITE;
    this.castling = 0;
    if (castling?.includes("K")) this.castling |= CASTLE_WK;
    if (castling?.includes("Q")) this.castling |= CASTLE_WQ;
    if (castling?.includes("k")) this.castling |= CASTLE_BK;
    if (castling?.includes("q")) this.castling |= CASTLE_BQ;
    this.ep = ep && ep !== "-" ? parseSq(ep) : -1;
    this.halfmove = Number(parts[4] ?? 0) || 0;
    this.fullmove = Number(parts[5] ?? 1) || 1;
    this.ply = 0;
    if (this.kings[0] < 0 || this.kings[1] < 0) throw new Error(`FEN has no king: ${fen}`);
  }

  fen(): string {
    let placement = "";
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[file | (rank << 4)] ?? 0;
        if (piece === 0) {
          empty++;
          continue;
        }
        if (empty) {
          placement += String(empty);
          empty = 0;
        }
        const letter = LETTER_OF[Math.abs(piece)] ?? "?";
        placement += piece > 0 ? letter.toUpperCase() : letter;
      }
      if (empty) placement += String(empty);
      if (rank) placement += "/";
    }
    let castling = "";
    if (this.castling & CASTLE_WK) castling += "K";
    if (this.castling & CASTLE_WQ) castling += "Q";
    if (this.castling & CASTLE_BK) castling += "k";
    if (this.castling & CASTLE_BQ) castling += "q";
    return `${placement} ${this.side === WHITE ? "w" : "b"} ${castling || "-"} ${this.ep < 0 ? "-" : sqName(this.ep)} ${this.halfmove} ${this.fullmove}`;
  }

  kingSq(color: Color): number {
    return this.kings[color === WHITE ? 0 : 1] ?? -1;
  }

  /** Is `sq` attacked by any piece of `by`? */
  isAttacked(sq: number, by: Color): boolean {
    const b = this.board;
    const pawn = PAWN * by;
    // a white pawn on s attacks s+15 and s+17, so s is attacked from sq-15/sq-17
    if (by === WHITE) {
      for (const off of [-17, -15]) {
        const s = sq + off;
        if (!(s & 0x88) && b[s] === pawn) return true;
      }
    } else {
      for (const off of [15, 17]) {
        const s = sq + off;
        if (!(s & 0x88) && b[s] === pawn) return true;
      }
    }
    const knight = KNIGHT * by;
    for (const d of KNIGHT_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === knight) return true;
    }
    const king = KING * by;
    for (const d of KING_D) {
      const s = sq + d;
      if (!(s & 0x88) && b[s] === king) return true;
    }
    const bishop = BISHOP * by;
    const rook = ROOK * by;
    const queen = QUEEN * by;
    for (const d of BISHOP_D) {
      for (let s = sq + d; !(s & 0x88); s += d) {
        const piece = b[s] ?? 0;
        if (piece === 0) continue;
        if (piece === bishop || piece === queen) return true;
        break;
      }
    }
    for (const d of ROOK_D) {
      for (let s = sq + d; !(s & 0x88); s += d) {
        const piece = b[s] ?? 0;
        if (piece === 0) continue;
        if (piece === rook || piece === queen) return true;
        break;
      }
    }
    return false;
  }

  inCheck(color: Color = this.side): boolean {
    const king = this.kingSq(color);
    return king >= 0 && this.isAttacked(king, color === WHITE ? BLACK : WHITE);
  }

  private addPawnMove(moves: Move[], from: number, to: number, flag: number): void {
    const rank = rankOf(to);
    if (rank === 0 || rank === 7) {
      for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) moves.push(mkMove(from, to, promo, flag));
      return;
    }
    moves.push(mkMove(from, to, 0, flag));
  }

  /** Pseudo-legal moves: everything except leaving your own king in check. */
  generatePseudo(): Move[] {
    const b = this.board;
    const moves: Move[] = [];
    const side = this.side;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7; // skip the dead half of the row
        continue;
      }
      const piece = b[sq] ?? 0;
      if (piece === 0 || (piece > 0) !== (side === WHITE)) continue;
      const type = Math.abs(piece);
      if (type === PAWN) {
        const forward = 16 * side;
        const startRank = side === WHITE ? 1 : 6;
        const one = sq + forward;
        if (!(one & 0x88) && (b[one] ?? 0) === 0) {
          this.addPawnMove(moves, sq, one, 0);
          const two = sq + forward * 2;
          if (rankOf(sq) === startRank && (b[two] ?? 0) === 0) this.addPawnMove(moves, sq, two, F_DOUBLE);
        }
        for (const off of [forward - 1, forward + 1]) {
          const to = sq + off;
          if (to & 0x88) continue;
          const target = b[to] ?? 0;
          if (target !== 0 && (target > 0) !== (side === WHITE)) this.addPawnMove(moves, sq, to, F_CAPTURE);
          else if (target === 0 && to === this.ep) moves.push(mkMove(sq, to, 0, F_EP | F_CAPTURE));
        }
        continue;
      }
      const deltas =
        type === KNIGHT ? KNIGHT_D : type === BISHOP ? BISHOP_D : type === ROOK ? ROOK_D : type === QUEEN ? [...BISHOP_D, ...ROOK_D] : KING_D;
      for (const d of deltas) {
        let to = sq + d;
        while (!(to & 0x88)) {
          const target = b[to] ?? 0;
          if (target === 0) {
            moves.push(mkMove(sq, to));
          } else {
            if ((target > 0) !== (side === WHITE)) moves.push(mkMove(sq, to, 0, F_CAPTURE));
            break;
          }
          if (type === KNIGHT || type === KING) break;
          to += d;
        }
      }
    }
    // castling, from the rights and the king's actual square
    if (side === WHITE) {
      if (this.castling & CASTLE_WK && (b[5] ?? 0) === 0 && (b[6] ?? 0) === 0 && (b[4] ?? 0) === KING && !this.isAttacked(4, BLACK) && !this.isAttacked(5, BLACK) && !this.isAttacked(6, BLACK))
        moves.push(mkMove(4, 6, 0, F_CASTLE));
      if (this.castling & CASTLE_WQ && (b[1] ?? 0) === 0 && (b[2] ?? 0) === 0 && (b[3] ?? 0) === 0 && (b[4] ?? 0) === KING && !this.isAttacked(4, BLACK) && !this.isAttacked(3, BLACK) && !this.isAttacked(2, BLACK))
        moves.push(mkMove(4, 2, 0, F_CASTLE));
    } else {
      if (this.castling & CASTLE_BK && (b[117] ?? 0) === 0 && (b[118] ?? 0) === 0 && (b[116] ?? 0) === -KING && !this.isAttacked(116, WHITE) && !this.isAttacked(117, WHITE) && !this.isAttacked(118, WHITE))
        moves.push(mkMove(116, 118, 0, F_CASTLE));
      if (this.castling & CASTLE_BQ && (b[113] ?? 0) === 0 && (b[114] ?? 0) === 0 && (b[115] ?? 0) === 0 && (b[116] ?? 0) === -KING && !this.isAttacked(116, WHITE) && !this.isAttacked(115, WHITE) && !this.isAttacked(114, WHITE))
        moves.push(mkMove(116, 114, 0, F_CASTLE));
    }
    return moves;
  }

  makeMove(m: Move): void {
    const from = fromOf(m);
    const to = toOf(m);
    const promo = promoOf(m);
    const flag = flagOf(m);
    const b = this.board;
    const piece = b[from] ?? 0;
    const i = this.ply++;

    this.uCastling[i] = this.castling;
    this.uEp[i] = this.ep;
    this.uHalfmove[i] = this.halfmove;
    this.uFullmove[i] = this.fullmove;
    this.uKingW[i] = this.kings[0];
    this.uKingB[i] = this.kings[1];
    this.uCaptured[i] = 0;
    this.uCapturedSq[i] = -1;

    if (flag & F_EP) {
      const capturedSq = to - 16 * this.side;
      this.uCaptured[i] = b[capturedSq] ?? 0;
      this.uCapturedSq[i] = capturedSq;
      b[capturedSq] = 0;
    } else if ((b[to] ?? 0) !== 0) {
      this.uCaptured[i] = b[to] ?? 0;
      this.uCapturedSq[i] = to;
    }

    b[to] = promo ? promo * this.side : piece;
    b[from] = 0;

    if (Math.abs(piece) === KING) this.kings[piece > 0 ? 0 : 1] = to;

    if (flag & F_CASTLE) {
      if (to === 6) {
        b[5] = b[7] ?? 0;
        b[7] = 0;
      } else if (to === 2) {
        b[3] = b[0] ?? 0;
        b[0] = 0;
      } else if (to === 118) {
        b[117] = b[119] ?? 0;
        b[119] = 0;
      } else if (to === 114) {
        b[115] = b[112] ?? 0;
        b[112] = 0;
      }
    }

    // a rook or king moving off its home square, or a rook being captured there,
    // costs the right whether or not the move was a castle
    for (const sq of [from, to]) {
      if (sq === 4) this.castling &= ~(CASTLE_WK | CASTLE_WQ);
      else if (sq === 7) this.castling &= ~CASTLE_WK;
      else if (sq === 0) this.castling &= ~CASTLE_WQ;
      else if (sq === 116) this.castling &= ~(CASTLE_BK | CASTLE_BQ);
      else if (sq === 119) this.castling &= ~CASTLE_BK;
      else if (sq === 112) this.castling &= ~CASTLE_BQ;
    }

    this.ep = flag & F_DOUBLE ? from + 16 * this.side : -1;

    const capturedOrPawn = (flag & F_CAPTURE) !== 0 || Math.abs(piece) === PAWN;
    this.halfmove = capturedOrPawn ? 0 : this.halfmove + 1;
    if (this.side === BLACK) this.fullmove++;
    this.side = this.side === WHITE ? BLACK : WHITE;
  }

  unmakeMove(m: Move): void {
    const from = fromOf(m);
    const to = toOf(m);
    const promo = promoOf(m);
    const flag = flagOf(m);
    const b = this.board;
    const i = --this.ply;

    this.side = this.side === WHITE ? BLACK : WHITE;
    const piece = promo ? PAWN * this.side : (b[to] ?? 0);
    b[from] = piece;
    b[to] = 0;

    const capturedSq = this.uCapturedSq[i] ?? -1;
    if (capturedSq >= 0) b[capturedSq] = this.uCaptured[i] ?? 0;

    if (flag & F_CASTLE) {
      if (to === 6) {
        b[7] = b[5] ?? 0;
        b[5] = 0;
      } else if (to === 2) {
        b[0] = b[3] ?? 0;
        b[3] = 0;
      } else if (to === 118) {
        b[119] = b[117] ?? 0;
        b[117] = 0;
      } else if (to === 114) {
        b[112] = b[115] ?? 0;
        b[115] = 0;
      }
    }

    this.castling = this.uCastling[i] ?? 0;
    this.ep = this.uEp[i] ?? -1;
    this.halfmove = this.uHalfmove[i] ?? 0;
    this.fullmove = this.uFullmove[i] ?? 1;
    this.kings = [this.uKingW[i] ?? -1, this.uKingB[i] ?? -1];
  }

  /** Legal moves. Defined by playing the move, so no pin can hide. */
  generateLegal(): Move[] {
    const pseudo = this.generatePseudo();
    const legal: Move[] = [];
    const mover = this.side;
    for (const m of pseudo) {
      this.makeMove(m);
      if (!this.inCheck(mover)) legal.push(m);
      this.unmakeMove(m);
    }
    return legal;
  }

  perft(depth: number): number {
    if (depth === 0) return 1;
    const moves = this.generateLegal();
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) {
      this.makeMove(m);
      nodes += this.perft(depth - 1);
      this.unmakeMove(m);
    }
    return nodes;
  }
}
