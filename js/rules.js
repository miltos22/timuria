export const WHITE_CITADEL = { f: 11, r: 1 };
export const BLACK_CITADEL = { f: -1, r: 8 };

export const PT = {
  KING: 'K', PRINCE: 'X', FERZ: 'F', WAZIR: 'W', GIRAFFE: 'G', SCOUT: 'S',
  KNIGHT: 'N', ROOK: 'R', ELEPHANT: 'E', CAMEL: 'C', DABBABA: 'D', PAWN: 'P_'
};

export const PROMOTION_MAP = {
  P_K: PT.PRINCE, P_F: PT.FERZ, P_W: PT.WAZIR, P_G: PT.GIRAFFE, P_S: PT.SCOUT,
  P_N: PT.KNIGHT, P_R: PT.ROOK, P_E: PT.ELEPHANT, P_C: PT.CAMEL, P_D: PT.DABBABA,
  P_P: PT.FERZ
};

export const PIECE_NAME = {
  K: 'king', X: 'prince', F: 'general', W: 'vizier', G: 'giraffe', S: 'scout',
  N: 'knight', R: 'rook', E: 'elephant', C: 'camel', D: 'warmachine', P_P: 'pawn'
};

export const PIECE_LABEL = {
  K: 'King', X: 'Prince', F: 'General', W: 'Vizier', G: 'Giraffe', S: 'Scout',
  N: 'Knight', R: 'Rook', E: 'Elephant', C: 'Camel', D: 'War Machine',
  P_P: 'Infantry Pawn', P_K: "King's Pawn", P_F: "General's Pawn", P_W: "Vizier's Pawn",
  P_G: "Giraffe's Pawn", P_S: "Scout's Pawn", P_N: "Knight's Pawn", P_R: "Rook's Pawn",
  P_E: "Elephant's Pawn", P_C: "Camel's Pawn", P_D: "War Machine's Pawn"
};

export const UPGRADE = { P_K: 'X', P_F: 'F', P_W: 'W', P_G: 'G', P_S: 'S', P_N: 'N', P_R: 'R', P_E: 'E', P_C: 'C', P_D: 'D', P_P: 'F' };

const DIRS_ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS_ALL8 = DIRS_ORTHO.concat(DIRS_DIAG);

export const onBoard = (f, r) => f >= 0 && f <= 10 && r >= 0 && r <= 9;
export const isPawnType = t => typeof t === 'string' && t.length > 1 && t[0] === 'P' && t[1] === '_';
export const key = (f, r) => f + ',' + r;
export const isWhiteCitadel = (f, r) => f === WHITE_CITADEL.f && r === WHITE_CITADEL.r;
export const isBlackCitadel = (f, r) => f === BLACK_CITADEL.f && r === BLACK_CITADEL.r;
export const isCitadel = (f, r) => isWhiteCitadel(f, r) || isBlackCitadel(f, r);

const enemyOf = c => (c === 'w' ? 'b' : 'w');
const otherTurn = c => (c === 'w' ? 'b' : 'w');

export function imageName(type) {
  if (isPawnType(type)) return type === 'P_P' ? 'pawn' : PIECE_NAME[UPGRADE[type]];
  return PIECE_NAME[type] || 'pawn';
}

export class Game {
  constructor() {
    this.board = new Map();
    this.turn = 'w';
    this.swapUsed = { w: false, b: false };
    this.history = [];
    this.result = null;
    this.setupStartPosition();
  }

  clone() {
    const g = Object.create(Game.prototype);
    g.board = new Map(this.board);
    g.turn = this.turn;
    g.swapUsed = { w: this.swapUsed.w, b: this.swapUsed.b };
    g.history = this.history.slice();
    g.result = this.result;
    return g;
  }

  setupStartPosition() {
    this.board.clear();
    const backRank = [PT.ROOK, PT.KNIGHT, PT.SCOUT, PT.GIRAFFE, PT.FERZ, PT.KING, PT.WAZIR, PT.GIRAFFE, PT.SCOUT, PT.KNIGHT, PT.ROOK];
    const flankRow = { 0: PT.ELEPHANT, 2: PT.CAMEL, 4: PT.DABBABA, 6: PT.DABBABA, 8: PT.CAMEL, 10: PT.ELEPHANT };
    const pawnRow = ['P_P', 'P_D', 'P_C', 'P_E', 'P_F', 'P_K', 'P_W', 'P_G', 'P_S', 'P_N', 'P_R'];
    for (let f = 0; f <= 10; f++) {
      if (flankRow[f]) this.board.set(key(f, 0), { type: flankRow[f], color: 'w' });
      this.board.set(key(f, 1), { type: backRank[f], color: 'w' });
      this.board.set(key(f, 2), { type: pawnRow[f], color: 'w' });
      if (flankRow[f]) this.board.set(key(f, 9), { type: flankRow[f], color: 'b' });
      this.board.set(key(f, 8), { type: backRank[f], color: 'b' });
      this.board.set(key(f, 7), { type: pawnRow[f], color: 'b' });
    }
  }

  get(f, r) { return this.board.get(key(f, r)); }
  set(f, r, piece) { if (piece) this.board.set(key(f, r), piece); else this.board.delete(key(f, r)); }

  findKing(color) {
    for (const [k, p] of this.board) {
      if (p.type === PT.KING && p.color === color) {
        const [f, r] = k.split(',').map(Number);
        return { f, r };
      }
    }
    return null;
  }

  countNonKing(color) {
    let n = 0;
    for (const p of this.board.values()) if (p.color === color && p.type !== PT.KING) n++;
    return n;
  }

  pseudoMovesFor(f, r) {
    const piece = this.get(f, r);
    if (!piece) return [];
    const color = piece.color;
    const enemy = enemyOf(color);
    const moves = [];

    const tryStep = (nf, nr, opts) => {
      opts = opts || {};
      if (!opts.allowCitadel && isCitadel(nf, nr)) return 'blocked';
      if (!onBoard(nf, nr) && !isCitadel(nf, nr)) return 'blocked';
      const occ = this.get(nf, nr);
      if (!occ) { moves.push({ f: nf, r: nr, capture: false }); return 'empty'; }
      if (occ.color === enemy) { moves.push({ f: nf, r: nr, capture: true }); return 'capture'; }
      return 'own';
    };

    const slide = (dirs, opts) => {
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (onBoard(nf, nr)) {
          const res = tryStep(nf, nr, opts);
          if (res === 'empty') { nf += df; nr += dr; continue; }
          break;
        }
      }
    };

    const type = piece.type;

    if (isPawnType(type)) {
      const dir = color === 'w' ? 1 : -1;
      const fwd = { f, r: r + dir };
      if (onBoard(fwd.f, fwd.r) && !this.get(fwd.f, fwd.r)) moves.push({ f: fwd.f, r: fwd.r, capture: false });
      for (const df of [-1, 1]) {
        const cf = f + df, cr = r + dir;
        if (!onBoard(cf, cr)) continue;
        const occ = this.get(cf, cr);
        if (occ && occ.color === enemy) moves.push({ f: cf, r: cr, capture: true });
      }
      return moves;
    }

    switch (type) {
      case PT.KING:
      case PT.PRINCE:
        for (const [df, dr] of DIRS_ALL8) tryStep(f + df, r + dr);
        if (type === PT.KING) {
          if (color === 'w' && this._adjacent(f, r, BLACK_CITADEL.f, BLACK_CITADEL.r)) {
            moves.push({ f: BLACK_CITADEL.f, r: BLACK_CITADEL.r, capture: false, citadel: true });
          }
          if (color === 'b' && this._adjacent(f, r, WHITE_CITADEL.f, WHITE_CITADEL.r)) {
            moves.push({ f: WHITE_CITADEL.f, r: WHITE_CITADEL.r, capture: false, citadel: true });
          }
        }
        break;
      case PT.FERZ:
        for (const [df, dr] of DIRS_DIAG) tryStep(f + df, r + dr);
        break;
      case PT.WAZIR:
        for (const [df, dr] of DIRS_ORTHO) tryStep(f + df, r + dr);
        break;
      case PT.KNIGHT:
        for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) tryStep(f + df, r + dr);
        break;
      case PT.ROOK:
        slide(DIRS_ORTHO);
        break;
      case PT.ELEPHANT:
        for (const [df, dr] of DIRS_DIAG) tryStep(f + df * 2, r + dr * 2);
        break;
      case PT.DABBABA:
        for (const [df, dr] of DIRS_ORTHO) tryStep(f + df * 2, r + dr * 2);
        break;
      case PT.CAMEL:
        for (const [df, dr] of [[3, 1], [3, -1], [-3, 1], [-3, -1], [1, 3], [1, -3], [-1, 3], [-1, -3]]) tryStep(f + df, r + dr);
        break;
      case PT.SCOUT: {
        for (const [df, dr] of DIRS_DIAG) {
          if (!onBoard(f + df, r + dr) || this.get(f + df, r + dr)) continue;
          let nf = f + df * 2, nr = r + dr * 2;
          while (onBoard(nf, nr)) {
            const res = tryStep(nf, nr);
            if (res === 'empty') { nf += df; nr += dr; continue; }
            break;
          }
        }
        break;
      }
      case PT.GIRAFFE: {
        for (const [dfd, drd] of DIRS_DIAG) {
          const pf = f + dfd, pr = r + drd;
          if (!onBoard(pf, pr) || this.get(pf, pr)) continue;
          for (const [df, dr] of [[dfd, 0], [0, drd]]) {
            const mid1 = { f: pf + df, r: pr + dr };
            const mid2 = { f: pf + df * 2, r: pr + dr * 2 };
            if (!onBoard(mid1.f, mid1.r) || this.get(mid1.f, mid1.r)) continue;
            if (!onBoard(mid2.f, mid2.r) || this.get(mid2.f, mid2.r)) continue;
            let nf = pf + df * 3, nr = pr + dr * 3;
            while (onBoard(nf, nr)) {
              const res = tryStep(nf, nr);
              if (res === 'empty') { nf += df; nr += dr; continue; }
              break;
            }
          }
        }
        break;
      }
    }
    return moves;
  }

  _adjacent(f1, r1, f2, r2) {
    return Math.abs(f1 - f2) <= 1 && Math.abs(r1 - r2) <= 1 && !(f1 === f2 && r1 === r2);
  }

  isSquareAttacked(f, r, byColor) {
    for (const [k, p] of this.board) {
      if (p.color !== byColor) continue;
      const [pf, pr] = k.split(',').map(Number);
      for (const m of this.pseudoMovesFor(pf, pr)) if (m.f === f && m.r === r) return true;
    }
    return false;
  }

  attackersOf(f, r, byColor) {
    const out = [];
    for (const [k, p] of this.board) {
      if (p.color !== byColor) continue;
      const [pf, pr] = k.split(',').map(Number);
      for (const m of this.pseudoMovesFor(pf, pr)) {
        if (m.f === f && m.r === r) { out.push({ f: pf, r: pr }); break; }
      }
    }
    return out;
  }

  checkThreats(color) {
    const k = this.findKing(color);
    if (!k) return [];
    return this.attackersOf(k.f, k.r, enemyOf(color));
  }

  isInCheck(color) {
    const k = this.findKing(color);
    if (!k) return false;
    return this.isSquareAttacked(k.f, k.r, enemyOf(color));
  }

  legalMovesFor(f, r) {
    const piece = this.get(f, r);
    if (!piece) return [];
    const legal = [];
    for (const m of this.pseudoMovesFor(f, r)) {
      const undo = this._applyRaw(f, r, m.f, m.r, piece, null);
      const bad = this.isInCheck(piece.color);
      this._undoRaw(undo);
      if (!bad) legal.push(m);
    }
    return legal;
  }

  movesFrom(f, r) {
    const piece = this.get(f, r);
    if (!piece) return [];
    const out = this.legalMovesFor(f, r).map(m => ({
      from: { f, r }, to: { f: m.f, r: m.r }, capture: !!m.capture, citadel: !!m.citadel
    }));
    if (piece.type === PT.KING && !this.swapUsed[piece.color]) {
      for (const [k, p] of Array.from(this.board.entries())) {
        if (p.color !== piece.color || p.type === PT.KING) continue;
        const [of, or] = k.split(',').map(Number);
        const kingPiece = this.get(f, r);
        const otherPiece = this.get(of, or);
        this.set(f, r, otherPiece);
        this.set(of, or, kingPiece);
        const bad = this.isInCheck(piece.color);
        this.set(f, r, kingPiece);
        this.set(of, or, otherPiece);
        if (!bad) out.push({ from: { f, r }, to: { f: of, r: or }, swap: true });
      }
    }
    return out;
  }

  allLegalMoves(color) {
    const out = [];
    for (const [k, p] of Array.from(this.board.entries())) {
      if (p.color !== color) continue;
      const [f, r] = k.split(',').map(Number);
      for (const m of this.movesFrom(f, r)) out.push({ ...m, from: { f, r } });
    }
    return out;
  }

  _applyRaw(ff, fr, tf, tr, piece, promoteTo) {
    const captured = this.get(tf, tr);
    this.set(ff, fr, null);
    this.set(tf, tr, promoteTo ? { type: promoteTo, color: piece.color } : piece);
    return { ff, fr, tf, tr, piece, captured };
  }

  _undoRaw(u) {
    this.set(u.tf, u.tr, u.captured || null);
    this.set(u.ff, u.fr, u.piece);
  }

  apply(move) {
    const piece = this.get(move.from.f, move.from.r);
    if (!piece) return false;
    const color = piece.color;
    if (move.swap) {
      const kingPiece = this.get(move.from.f, move.from.r);
      const otherPiece = this.get(move.to.f, move.to.r);
      this.set(move.from.f, move.from.r, otherPiece);
      this.set(move.to.f, move.to.r, kingPiece);
      this.swapUsed[color] = true;
      this.history.push({ move, piece, swap: true });
    } else {
      const captured = this.get(move.to.f, move.to.r);
      let finalType = piece.type;
      if (isPawnType(piece.type) && move.to.r === (color === 'w' ? 9 : 0)) {
        finalType = PROMOTION_MAP[piece.type] || PT.FERZ;
      }
      this.set(move.from.f, move.from.r, null);
      this.set(move.to.f, move.to.r, { type: finalType, color });
      this.history.push({ move, piece, captured, promotedTo: finalType !== piece.type ? finalType : null });
    }
    this.turn = otherTurn(color);
    this._cheapEnd(move, color);
    return true;
  }

  _cheapEnd(lastMove, moverColor) {
    if (lastMove.citadel) { this.result = { winner: null, reason: 'citadel' }; return; }
    const opp = otherTurn(moverColor);
    const moverBare = this.countNonKing(moverColor) === 0;
    const oppBare = this.countNonKing(opp) === 0;
    if (moverBare || oppBare) {
      if (moverBare && oppBare) this.result = { winner: null, reason: 'bare-both' };
      else if (oppBare) this.result = { winner: moverColor, reason: 'bare-king' };
      else this.result = { winner: opp, reason: 'bare-king' };
    }
  }

  finalizeTurn(precomputedMoves) {
    if (this.result) return precomputedMoves || [];
    const moves = precomputedMoves || this.allLegalMoves(this.turn);
    if (moves.length === 0) {
      const winner = otherTurn(this.turn);
      this.result = { winner, reason: this.isInCheck(this.turn) ? 'checkmate' : 'stalemate' };
    }
    return moves;
  }

  play(move) {
    if (this.result) return false;
    const from = move.from;
    const piece = this.get(from.f, from.r);
    if (!piece || piece.color !== this.turn) return false;
    const found = this.movesFrom(from.f, from.r).find(m =>
      m.to.f === move.to.f && m.to.r === move.to.r && !!m.swap === !!move.swap);
    if (!found) return false;
    this.apply(found);
    this.finalizeTurn();
    return true;
  }

  hash() {
    const parts = [];
    for (const [k, p] of Array.from(this.board.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      parts.push(k, p.color, p.type);
    }
    parts.push(this.turn, this.swapUsed.w ? '1' : '0', this.swapUsed.b ? '1' : '0');
    if (this.result) parts.push('r', this.result.winner || '-', this.result.reason);
    let h = 2166136261;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  static fromMoves(moves) {
    const g = new Game();
    for (const m of moves) {
      if (!g.play(m)) return null;
    }
    return g;
  }
}

export function packMove(m) {
  return [m.from.f, m.from.r, m.to.f, m.to.r, m.swap ? 1 : 0];
}
export function unpackMove(a) {
  return { from: { f: a[0], r: a[1] }, to: { f: a[2], r: a[3] }, swap: !!a[4] };
}
