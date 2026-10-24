import { Game, isPawnType, imageName, packMove, unpackMove, PIECE_LABEL, UPGRADE } from './rules.js';
import { BROKERS, randId, makeCode, codeBroker, isValidCode, connectBroker, NetRoom } from './net.js';

const $ = id => document.getElementById(id);
const app = $('app');
const boardEl = $('board');
const playBtn = $('playBtn');
const statusEl = $('status');
const movesBtn = $('movesBtn');
const menuBtn = $('menuBtn');
const menuEl = $('menu');
const clocksEl = $('clocks');
const clockW = $('clockW');
const clockB = $('clockB');
const overlayEl = $('overlay');
const overTitle = $('overTitle');
const overSub = $('overSub');
const overCfg = $('overCfg');
const rematchCfg = $('rematchCfg');
const drawerEl = $('drawer');
const playersLine = $('playersLine');
const capturedEl = $('captured');
const moveListEl = $('moveList');
const sheetEl = $('sheet');
const sheetMain = $('sheetMain');
const waitBox = $('waitBox');
const sheetMsg = $('sheetMsg');
const waitMsg = $('waitMsg');
const waitCfg = $('waitCfg');
const roomCodeEl = $('roomCode');
const codeInput = $('codeInput');
const nameInput = $('nameInput');
const passInput = $('passInput');
const joinPass = $('joinPass');
const passRow = $('passRow');
const joinPassBtn = $('passBtn');
const recentBox = $('recentBox');
const recentList = $('recentList');
const resumeBtn = $('resumeBtn');
const howtoEl = $('howto');
const demoBoard = $('demoBoard');
const howCount = $('howCount');
const howName = $('howName');
const howRule = $('howRule');
const pieceStrip = $('pieceStrip');
const soundBtn = $('soundBtn');
const lobbyList = $('lobbyList');
const lobbyMsg = $('lobbyMsg');

const myId = sessionStorage.getItem('timuria_id') || (() => {
  const id = 'P' + randId(10);
  sessionStorage.setItem('timuria_id', id);
  return id;
})();

const qs = new URLSearchParams(location.search);
const mqttOverride = qs.get('mqtt') || '';

let game = new Game();
let mode = 'idle';
let hostColor = 'w';
let myColor = 'w';
let flipped = false;
let started = false;
let selected = null;
let legal = [];
let lastMove = null;
let pending = false;
let pendingTimer = null;
let net = null;
let netStatus = '';
let connected = false;
let roomCode = null;
let guestId = null;
let guestSecret = null;
let guestSeen = 0;
let hostSeen = 0;
let hbTimer = null;
let uiTimer = null;
let lastResync = 0;
let drawerOpen = false;
let soundOn = localStorage.getItem('timuria_sound') !== '0';
let roomPassHash = '';
let guestPassHash = '';
let passFails = {};
let playerName = localStorage.getItem('timuria_name') || '';
let names = { host: '', guest: '' };
let recent = [];
let timer = { on: false, baseMin: 10, incSec: 5, clock: { w: 0, b: 0 }, started: false, turnStart: 0 };
let savedHost = null;
let lobbyClient = null;
let lobbyTimer = null;
let lobbySeq = 0;
let lobbyReady = false;
let lobbyError = '';
let hostLobbyClient = null;
let hostLobbyTimer = null;
const lobbyRooms = new Map();
const LOBBY_TOPIC = 'timuria/v1/lobby';
let actx = null;
let demoType = 'N';
let demoBlocked = false;
let demoStart = 0;
let demoTimer = null;
let howReturn = false;
let pendingJoinCode = '';

const other = c => (c === 'w' ? 'b' : 'w');
const colorName = c => (c === 'w' ? 'White' : 'Gold');
const key = (f, r) => f + ',' + r;

try { recent = JSON.parse(localStorage.getItem('timuria_players') || '[]'); } catch { recent = []; }

function pos(f, r) {
  return flipped ? { col: 12 - f, row: r + 1 } : { col: f + 2, row: 10 - r };
}

function pieceHTML(p) {
  const pawn = isPawnType(p.type);
  const color = p.color === 'w' ? 'white' : 'black';
  const src = `assets/pieces/${imageName(p.type)}_${color}.webp`;
  return `<span class="piece${pawn ? ' pawn' : ''}"><img src="${src}" alt="" draggable="false">${pawn ? '<i class="badge"></i>' : ''}</span>`;
}

function addCell(cls, f, r, inner = '') {
  const el = document.createElement('div');
  el.className = cls;
  const p = pos(f, r);
  el.style.gridColumn = p.col;
  el.style.gridRow = p.row;
  el.dataset.base = cls;
  el.dataset.f = f;
  el.dataset.r = r;
  if (inner) el.innerHTML = inner;
  boardEl.appendChild(el);
}

function buildBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r <= 9; r++) {
    for (let f = 0; f <= 10; f++) {
      addCell('square ' + ((f + r) % 2 === 0 ? 'light' : 'dark'), f, r);
    }
  }
  addCell('square citadel citadel-black', -1, 8, '<span class="ball"></span>');
  addCell('square citadel citadel-white', 11, 1, '<span class="ball"></span>');
}

function render() {
  const byTo = new Map();
  for (const m of legal) byTo.set(key(m.to.f, m.to.r), m);
  const lastKeys = lastMove ? new Set([key(lastMove.from.f, lastMove.from.r), key(lastMove.to.f, lastMove.to.r)]) : null;
  const inCheck = !game.result && game.isInCheck(game.turn);
  const king = inCheck ? game.findKing(game.turn) : null;
  const sources = inCheck ? game.checkThreats(game.turn) : [];
  const sourceKeys = new Set(sources.map(s => key(s.f, s.r)));
  const selKey = selected ? key(selected.f, selected.r) : null;

  for (const el of boardEl.children) {
    const f = +el.dataset.f;
    const r = +el.dataset.r;
    const k = key(f, r);
    const cit = el.dataset.base.includes('citadel');
    let cls = el.dataset.base;
    if (k === selKey) cls += ' selected';
    if (lastKeys && lastKeys.has(k)) cls += ' last';
    const mv = byTo.get(k);
    if (mv) {
      if (mv.swap) cls += ' swap';
      else if (mv.citadel) cls += ' legal-citadel';
      else if (mv.capture) cls += ' capture';
      else cls += ' legal';
    }
    if (king && king.f === f && king.r === r) cls += ' in-check';
    if (sourceKeys.has(k)) cls += ' check-source';
    el.className = cls;
    if (!cit) {
      const p = game.get(f, r);
      el.innerHTML = p ? pieceHTML(p) : '';
      el.title = p ? `${p.color === 'w' ? 'White' : 'Gold'} ${PIECE_LABEL[p.type] || p.type}` : '';
    }
  }
  updateHud();
  updateClocksUI();
  renderClocks();
  renderDrawer();
}

function updateHud() {
  playBtn.hidden = mode === 'host' || mode === 'guest';
  movesBtn.hidden = !started;
  menuBtn.hidden = !(mode === 'host' || mode === 'guest');
  if (mode === 'idle') {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.className = 'status';
  let text = '';
  if (mode === 'local') {
    text = game.result ? 'Game over' : (game.turn === 'w' ? 'White to move' : 'Gold to move');
  } else {
    statusEl.classList.add('online');
    if (!connected) {
      text = mode === 'host' ? 'Waiting for opponent\u2026' : 'Connecting\u2026';
    } else if (Date.now() - (mode === 'host' ? guestSeen : hostSeen) > 16000) {
      text = 'Opponent offline';
      statusEl.classList.add('warn');
    } else if (game.result) {
      text = 'Game over';
    } else if (pending) {
      text = 'Sending\u2026';
    } else {
      text = game.turn === myColor ? 'Your move' : "Opponent's move";
    }
    if (netStatus === 'closed' || netStatus === 'reconnecting') {
      text = 'Reconnecting\u2026';
      statusEl.classList.add('warn');
    }
  }
  statusEl.textContent = text;
}

function updateClocksUI() {
  const show = timer.on && started && (mode === 'host' || mode === 'guest');
  clocksEl.hidden = !show;
  app.classList.toggle('timed', show);
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function remainingNow(c) {
  if (!timer.on) return 0;
  const base = timer.clock[c] || 0;
  if (!timer.started || game.result) return base;
  if (c !== game.turn) return base;
  return Math.max(0, base - (Date.now() - timer.turnStart));
}

function clockNow() {
  return { w: remainingNow('w'), b: remainingNow('b') };
}

function initTimer(cfg, start) {
  timer.on = !!cfg.on;
  timer.baseMin = cfg.baseMin || 10;
  timer.incSec = cfg.incSec || 0;
  timer.clock = { w: timer.baseMin * 60000, b: timer.baseMin * 60000 };
  timer.started = !!cfg.on && !!start;
  timer.turnStart = Date.now();
}

function renderClocks() {
  if (!timer.on || !started || (mode !== 'host' && mode !== 'guest')) return;
  const wName = hostColor === 'w' ? names.host : names.guest;
  const bName = hostColor === 'b' ? names.host : names.guest;
  clockW.querySelector('.cname').textContent = 'White' + (wName ? ' \u00b7 ' + wName : '');
  clockB.querySelector('.cname').textContent = 'Gold' + (bName ? ' \u00b7 ' + bName : '');
  const wr = remainingNow('w');
  const br = remainingNow('b');
  clockW.querySelector('.ctime').textContent = fmtTime(wr);
  clockB.querySelector('.ctime').textContent = fmtTime(br);
  const active = timer.started && !game.result;
  clockW.classList.toggle('active', active && game.turn === 'w');
  clockB.classList.toggle('active', active && game.turn === 'b');
  clockW.classList.toggle('low', timer.on && wr < 20000);
  clockB.classList.toggle('low', timer.on && br < 20000);
}

function timeout(color) {
  if (game.result) return;
  timer.clock[color] = 0;
  game.result = { winner: other(color), reason: 'timeout' };
  if (mode === 'host') { publishState(null); saveHost(); }
  render();
  showOverlay();
  playSound('end');
}

function checkFlag() {
  if (mode !== 'host' || !timer.on || !timer.started || !connected || !started || game.result) return;
  if (remainingNow(game.turn) <= 0) timeout(game.turn);
}

function onSquare(f, r) {
  if (!canPlayNow()) return;
  const mv = selected ? legal.find(m => m.to.f === f && m.to.r === r) : null;
  if (mv) return commit(mv);
  const p = game.get(f, r);
  const actor = mode === 'local' ? game.turn : myColor;
  if (p && p.color === actor) {
    selected = { f, r };
    legal = game.movesFrom(f, r);
    render();
    return;
  }
  if (selected) { selected = null; legal = []; render(); }
}

function canPlayNow() {
  if (!started || game.result || !overlayEl.hidden) return false;
  if (mode === 'local') return true;
  if (mode === 'host') return connected && game.turn === myColor;
  if (mode === 'guest') return connected && !pending && game.turn === myColor && Date.now() - hostSeen < 16000;
  return false;
}

function clockBeforeMove(color) {
  if (!timer.on || !timer.started) return null;
  return remainingNow(color);
}

function afterAppliedMove(mv) {
  lastMove = mv;
  render();
  soundForMove();
  animateMove(mv);
  if (game.result) showOverlay();
}

function applyClockAfter(mover, before) {
  if (before === null) return;
  timer.clock[mover] = Math.max(0, before) + timer.incSec * 1000;
  timer.turnStart = Date.now();
}

function commit(mv) {
  selected = null;
  legal = [];
  if (mode === 'local') {
    if (!game.play(mv)) { render(); return; }
    afterAppliedMove(mv);
    return;
  }
  if (mode === 'host') {
    if (game.turn !== myColor) return;
    const before = clockBeforeMove(myColor);
    if (before !== null && before <= 0) { timeout(myColor); return; }
    if (!game.play(mv)) { render(); return; }
    applyClockAfter(myColor, before);
    afterAppliedMove(mv);
    publishState(mv);
    saveHost();
    return;
  }
  if (!net) return;
  net.send({ t: 'move', v: 2, id: myId, secret: guestSecret, base: game.history.length, move: packMove(mv) });
  pending = true;
  updateHud();
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (!pending) return;
    pending = false;
    requestSync();
    updateHud();
  }, 7000);
  render();
}

function historyPacked() { return game.history.map(h => packMove(h.move)); }

function publishState(last) {
  if (!net) return;
  net.send({
    t: 'state', v: 2, to: guestId, seq: game.history.length,
    move: last ? packMove(last) : null, result: game.result, hash: game.hash(), clock: clockNow()
  });
}

function sendSync() {
  if (!net) return;
  net.send({
    t: 'sync', v: 2, to: guestId, seq: game.history.length, moves: historyPacked(),
    result: game.result, hash: game.hash(), hostColor, names,
    timed: timer.on, baseMin: timer.baseMin, incSec: timer.incSec, clock: clockNow()
  });
}

function requestSync() {
  if (!net || mode !== 'guest') return;
  const now = Date.now();
  if (now - lastResync < 2000) return;
  lastResync = now;
  net.send({ t: 'resync', v: 2, id: myId, secret: guestSecret });
}

function sanitizeName(n) {
  return String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20);
}

function passKey(id) { return String(id || '').slice(0, 24); }

function checkPass(msg) {
  if (!roomPassHash) return true;
  if (msg.pass === roomPassHash) return true;
  const k = passKey(msg.id);
  const cur = passFails[k] || { n: 0, until: 0 };
  if (cur.until && Date.now() < cur.until) return false;
  cur.n += 1;
  if (cur.n >= 5) { cur.until = Date.now() + 30000; cur.n = 0; }
  passFails[k] = cur;
  net.send({ t: msg.pass ? 'badpass' : 'needpass', v: 2, to: msg.id });
  return false;
}

function welcomeMsg(secret) {
  return {
    t: 'welcome', v: 2, hostId: myId, guestId, secret,
    hostName: names.host, names, hostColor,
    seq: game.history.length, moves: historyPacked(), result: game.result, hash: game.hash(),
    timed: timer.on, baseMin: timer.baseMin, incSec: timer.incSec, clock: clockNow()
  };
}

function acceptGuest(msg) {
  if (msg.v !== 2) return;
  if (guestId && guestId !== msg.id && Date.now() - guestSeen < 20000) {
    net.send({ t: 'busy', v: 2, to: msg.id });
    return;
  }
  if (!checkPass(msg)) return;
  guestId = msg.id;
  guestSecret = randId(10);
  guestSeen = Date.now();
  connected = true;
  const nm = sanitizeName(msg.name) || 'Guest';
  names.guest = nm;
  if (timer.on) {
    timer.started = true;
    timer.turnStart = Date.now();
  }
  addRecent(nm);
  hideSheet();
  net.send(welcomeMsg(guestSecret));
  saveHost();
  announceLobby();
  render();
}

function hostHandle(msg) {
  if (!net) return;
  if (msg.t === 'join' || msg.t === 'rejoin') { acceptGuest(msg); return; }
  if (msg.t === 'move') {
    if (msg.id !== guestId || msg.secret !== guestSecret) return;
    guestSeen = Date.now();
    if (msg.base !== game.history.length || game.turn !== other(hostColor) || game.result) { sendSync(); return; }
    const before = clockBeforeMove(game.turn);
    if (before !== null && before <= 0) { timeout(game.turn); return; }
    const mv = unpackMove(msg.move);
    if (!game.play(mv)) { sendSync(); return; }
    applyClockAfter(other(hostColor), before);
    afterAppliedMove(mv);
    publishState(mv);
    saveHost();
    return;
  }
  if (msg.t === 'hb') {
    if (msg.id === guestId) guestSeen = Date.now();
    return;
  }
  if (msg.t === 'resync') { if (msg.id === guestId) sendSync(); return; }
  if (msg.t === 'resign') {
    if (msg.id !== guestId || msg.secret !== guestSecret) return;
    game.result = { winner: hostColor, reason: 'resign' };
    guestSeen = Date.now();
    publishState(null);
    render();
    showOverlay();
    saveHost();
    return;
  }
  if (msg.t === 'rematch') {
    if (msg.id !== guestId || msg.secret !== guestSecret) return;
    hostRematch();
  }
}

function applySnapshot(msg) {
  if (!msg) return false;
  const packed = msg.moves || [];
  const g = Game.fromMoves(packed.map(unpackMove));
  if (!g) return false;
  game = g;
  if (msg.result) game.result = msg.result;
  hostColor = msg.hostColor || 'w';
  myColor = other(hostColor);
  names = msg.names || { host: msg.hostName || '', guest: '' };
  timer.on = !!msg.timed;
  timer.baseMin = msg.baseMin || 10;
  timer.incSec = msg.incSec || 5;
  timer.clock = msg.clock || { w: timer.baseMin * 60000, b: timer.baseMin * 60000 };
  timer.started = timer.on && !game.result;
  timer.turnStart = Date.now();
  lastMove = packed.length ? unpackMove(packed[packed.length - 1]) : null;
  pending = false;
  clearTimeout(pendingTimer);
  selected = null;
  legal = [];
  const flip = myColor === 'b';
  if (flip !== flipped) { flipped = flip; buildBoard(); }
  hideSheet();
  render();
  if (game.result) showOverlay();
  return true;
}

function guestHandle(msg) {
  if (!net) return;
  if (msg.t === 'host-ready') {
    net.send({ t: 'rejoin', v: 2, id: myId, name: playerName, pass: guestPassHash });
    return;
  }
  if (msg.t === 'welcome') {
    if (msg.guestId && msg.guestId !== myId) return;
    guestSecret = msg.secret;
    connected = true;
    hostSeen = Date.now();
    if (!applySnapshot(msg)) { requestSync(); return; }
    addRecent(names.host);
    return;
  }
  if (msg.t === 'state') {
    if (msg.to && msg.to !== myId) return;
    hostSeen = Date.now();
    if (msg.seq === game.history.length + 1 && msg.move) {
      const mv = unpackMove(msg.move);
      if (!game.play(mv)) { requestSync(); return; }
      afterAppliedMove(mv);
    } else if (msg.seq !== game.history.length) {
      requestSync();
      return;
    }
    if (msg.result) game.result = msg.result;
    if (msg.clock) timer.clock = msg.clock;
    timer.turnStart = Date.now();
    pending = false;
    clearTimeout(pendingTimer);
    if (msg.hash && game.hash() !== msg.hash) { requestSync(); return; }
    render();
    if (game.result) showOverlay();
    return;
  }
  if (msg.t === 'sync') {
    if (msg.to && msg.to !== myId) return;
    hostSeen = Date.now();
    applySnapshot(msg);
    return;
  }
  if (msg.t === 'busy') {
    if (msg.to && msg.to !== myId) return;
    setSheetMsg('That room already has two players.');
    openSheet();
    return;
  }
  if (msg.t === 'needpass') {
    if (msg.to && msg.to !== myId) return;
    passRow.hidden = false;
    setSheetMsg('This room needs a password.');
    openSheet();
    joinPass.focus();
    return;
  }
  if (msg.t === 'badpass') {
    if (msg.to && msg.to !== myId) return;
    setSheetMsg('Wrong password. Wait a moment and try again.');
    joinPassBtn.disabled = true;
    setTimeout(() => { joinPassBtn.disabled = false; }, 2000);
    return;
  }
  if (msg.t === 'rematch-start') {
    hostSeen = Date.now();
    hostColor = msg.hostColor || 'w';
    myColor = other(hostColor);
    timer.on = !!msg.timed;
    timer.baseMin = msg.baseMin || 10;
    timer.incSec = msg.incSec || 5;
    timer.clock = msg.clock || { w: timer.baseMin * 60000, b: timer.baseMin * 60000 };
    timer.started = timer.on;
    timer.turnStart = Date.now();
    game = new Game();
    lastMove = null;
    selected = null;
    legal = [];
    pending = false;
    const flip = myColor === 'b';
    if (flip !== flipped) { flipped = flip; buildBoard(); }
    hideOverlay();
    render();
    return;
  }
  if (msg.t === 'hb') {
    if (msg.role === 'host') hostSeen = Date.now();
    if (typeof msg.seq === 'number' && msg.seq > game.history.length) requestSync();
  }
}

function openRoom(code, role, client) {
  return new Promise(async (resolve, reject) => {
    const room = new NetRoom(code, role, client, mqttOverride);
    net = room;
    room.onMessage = role === 'host' ? hostHandle : guestHandle;
    room.onStatus = s => { netStatus = s; if (s === 'closed' && role === 'guest') connected = false; updateHud(); };
    room.onReconnect = () => {
      if (!net) return;
      if (role === 'guest') net.send({ t: 'rejoin', v: 2, id: myId, name: playerName, pass: guestPassHash });
      else net.send({ t: 'hb', v: 2, id: myId, role: 'host', seq: game.history.length });
      updateHud();
    };
    try {
      await room.start();
      netStatus = 'connected';
      startHeartbeat();
      updateHud();
      resolve(room);
    } catch (e) {
      net = null;
      try { client.end(true); } catch {}
      reject(e);
    }
  });
}

function startHeartbeat() {
  clearInterval(hbTimer);
  clearInterval(uiTimer);
  hbTimer = setInterval(() => {
    if (net) {
      const msg = { t: 'hb', v: 2, id: myId, role: mode };
      if (mode === 'host') msg.seq = game.history.length;
      net.send(msg);
    }
    updateHud();
  }, 5000);
  uiTimer = setInterval(() => { updateHud(); renderClocks(); checkFlag(); }, 200);
}

function cleanupNet() {
  stopHostLobby(true);
  clearInterval(hbTimer);
  clearInterval(uiTimer);
  clearTimeout(pendingTimer);
  hbTimer = null;
  uiTimer = null;
  if (net) net.close();
  net = null;
  netStatus = '';
  connected = false;
  roomCode = null;
  guestId = null;
  guestSecret = null;
  guestSeen = 0;
  hostSeen = 0;
  pending = false;
}

function resetToIdle() {
  cleanupNet();
  mode = 'idle';
  hostColor = 'w';
  myColor = 'w';
  flipped = false;
  started = false;
  game = new Game();
  selected = null;
  legal = [];
  lastMove = null;
  names = { host: '', guest: '' };
  timer = { on: false, baseMin: 10, incSec: 5, clock: { w: 0, b: 0 }, started: false, turnStart: 0 };
  hideOverlay();
  drawerOpen = false;
  drawerEl.hidden = true;
  buildBoard();
  render();
}

function startLocal() {
  closeLobby();
  cleanupNet();
  mode = 'local';
  myColor = 'both';
  flipped = false;
  started = true;
  game = new Game();
  selected = null;
  legal = [];
  lastMove = null;
  names = { host: playerName || 'You', guest: 'Friend' };
  timer.on = false;
  hideOverlay();
  hideSheet();
  buildBoard();
  render();
}

function readTimer(onEl, baseEl, incEl) {
  if (!onEl.checked) return { on: false, baseMin: 10, incSec: 5 };
  const b = Number(baseEl.value);
  const i = Number(incEl.value);
  if (!Number.isInteger(b) || b < 1 || b > 180) return null;
  if (!Number.isInteger(i) || i < 0 || i > 900) return null;
  return { on: true, baseMin: b, incSec: i };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), x => x.toString(16).padStart(2, '0')).join('');
}

function readName() {
  const nm = sanitizeName(nameInput.value);
  if (!nm) { setSheetMsg('Enter your name.'); nameInput.focus(); return ''; }
  playerName = nm;
  nameInput.value = nm;
  localStorage.setItem('timuria_name', nm);
  return nm;
}

function addRecent(name) {
  const nm = sanitizeName(name);
  if (!nm) return;
  recent = [nm, ...recent.filter(x => x.toLowerCase() !== nm.toLowerCase())].slice(0, 12);
  localStorage.setItem('timuria_players', JSON.stringify(recent));
  renderRecent();
}

function renderRecent() {
  recentBox.hidden = recent.length === 0;
  recentList.textContent = '';
  for (const n of recent) {
    const s = document.createElement('span');
    s.textContent = n;
    recentList.appendChild(s);
  }
}

function saveHost() {
  if (mode !== 'host' || !roomCode) return;
  const data = {
    code: roomCode, hostColor, names, moves: historyPacked(), result: game.result,
    timed: timer.on, baseMin: timer.baseMin, incSec: timer.incSec, clock: timer.clock,
    timerStarted: timer.started, passHash: roomPassHash, at: Date.now()
  };
  try { localStorage.setItem('timuria_host', JSON.stringify(data)); } catch {}
  savedHost = data;
}

function loadHostSave() {
  try {
    const d = JSON.parse(localStorage.getItem('timuria_host'));
    if (!d || !d.code || !isValidCode(d.code)) return null;
    if (Date.now() - (d.at || 0) > 86400000) return null;
    return d;
  } catch { return null; }
}

function clearHostSave() {
  try { localStorage.removeItem('timuria_host'); } catch {}
  savedHost = null;
  resumeBtn.hidden = true;
}

async function createRoom() {
  const nm = readName();
  if (!nm) return;
  const cfg = readTimer(timerOn, baseMin, incSec);
  if (!cfg) { setSheetMsg('Clock: base 1-180 min, increment 0-900 s.'); return; }
  const pass = passInput.value.trim();
  roomPassHash = pass ? await sha256Hex(pass) : '';
  closeLobby();
  cleanupNet();
  setSheetMsg('Connecting to server\u2026');
  let client = null;
  let index = 0;
  for (let i = 0; i < BROKERS.length; i++) {
    try { client = await connectBroker(i, mqttOverride); index = i; break; } catch { if (mqttOverride) break; }
  }
  if (!client) { setSheetMsg('Could not reach the game server. Try again.'); return; }
  const code = makeCode(index);
  try { await openRoom(code, 'host', client); } catch { setSheetMsg('Could not open the room. Try again.'); return; }
  mode = 'host';
  hostColor = 'w';
  myColor = 'w';
  flipped = false;
  started = true;
  roomCode = code;
  names = { host: nm, guest: '' };
  game = new Game();
  selected = null;
  legal = [];
  lastMove = null;
  pending = false;
  connected = false;
  initTimer(cfg, false);
  buildBoard();
  render();
  roomCodeEl.textContent = code;
  waitMsg.textContent = 'Waiting for your opponent\u2026';
  waitCfg.textContent = (cfg.on ? `Clock: ${cfg.baseMin} min + ${cfg.incSec} s per move` : 'No clock') + (roomPassHash ? ' \u00b7 password required' : '');
  sheetEl.hidden = false;
  sheetMain.hidden = true;
  waitBox.hidden = false;
  passInput.value = '';
  saveHost();
  startHostLobby();
}

async function sendJoin(pass) {
  if (!net) return;
  net.send({ t: 'join', v: 2, id: myId, name: playerName, pass: pass || '' });
}

async function startGuest(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!isValidCode(code)) { setSheetMsg('Enter a valid 13-character room code.'); openSheet(); return; }
  codeInput.value = code;
  pendingJoinCode = code;
  if (!readName()) { openSheet(); return; }
  closeLobby();
  cleanupNet();
  mode = 'guest';
  myColor = 'b';
  hostColor = 'w';
  started = true;
  if (!flipped) { flipped = true; buildBoard(); }
  game = new Game();
  selected = null;
  legal = [];
  lastMove = null;
  timer.on = false;
  setSheetMsg('Connecting\u2026');
  passRow.hidden = true;
  openSheet();
  render();
  let client;
  try { client = await connectBroker(codeBroker(code), mqttOverride); }
  catch { setSheetMsg('Could not reach that room\u2019s server. Check the code.'); return; }
  try { await openRoom(code, 'guest', client); }
  catch { setSheetMsg('Could not join the room. Try again.'); return; }
  roomCode = code;
  await sendJoin(guestPassHash);
  updateHud();
  setTimeout(() => {
    if (mode === 'guest' && !connected) {
      setSheetMsg('No answer from the host. Is their game still open?');
      openSheet();
    }
  }, 10000);
}

async function resumeHost() {
  const d = savedHost;
  if (!d) return;
  cleanupNet();
  setSheetMsg('Reconnecting\u2026');
  closeLobby();
  let client;
  try { client = await connectBroker(codeBroker(d.code), mqttOverride); }
  catch { setSheetMsg('Could not reach the room. Try again.'); return; }
  mode = 'host';
  roomCode = d.code;
  hostColor = d.hostColor || 'w';
  myColor = hostColor;
  flipped = myColor === 'b';
  names = d.names || { host: playerName, guest: '' };
  roomPassHash = d.passHash || '';
  timer.on = !!d.timed;
  timer.baseMin = d.baseMin || 10;
  timer.incSec = d.incSec || 5;
  timer.clock = d.clock || { w: timer.baseMin * 60000, b: timer.baseMin * 60000 };
  timer.started = !!d.timerStarted;
  timer.turnStart = Date.now();
  const g = Game.fromMoves((d.moves || []).map(unpackMove));
  if (!g) { setSheetMsg('Saved game is damaged.'); return; }
  game = g;
  if (d.result) game.result = d.result;
  lastMove = d.moves && d.moves.length ? unpackMove(d.moves[d.moves.length - 1]) : null;
  started = true;
  connected = false;
  guestId = null;
  guestSecret = null;
  selected = null;
  legal = [];
  buildBoard();
  render();
  try { await openRoom(d.code, 'host', client); }
  catch { setSheetMsg('Could not reconnect. Try again.'); return; }
  roomCodeEl.textContent = d.code;
  waitMsg.textContent = 'Waiting for your opponent to rejoin\u2026';
  waitCfg.textContent = (timer.on ? `Clock: ${timer.baseMin} min + ${timer.incSec} s per move` : 'No clock') + (roomPassHash ? ' \u00b7 password required' : '');
  sheetEl.hidden = false;
  sheetMain.hidden = true;
  waitBox.hidden = false;
  net.send({ t: 'host-ready', v: 2 });
  saveHost();
  startHostLobby();
}

function hostRematch() {
  const cfg = readTimer($('rTimerOn'), $('rBaseMin'), $('rIncSec'));
  if (!cfg) { overCfg.hidden = false; overCfg.textContent = 'Clock: base 1-180 min, increment 0-900 s.'; return; }
  hostColor = other(hostColor);
  myColor = hostColor;
  flipped = myColor === 'b';
  game = new Game();
  lastMove = null;
  selected = null;
  legal = [];
  pending = false;
  initTimer(cfg, true);
  hideOverlay();
  buildBoard();
  render();
  saveHost();
  if (net) net.send({ t: 'rematch-start', v: 2, hostColor, timed: cfg.on, baseMin: cfg.baseMin, incSec: cfg.incSec, clock: clockNow() });
}

function showOverlay() {
  if (!game.result) return;
  const who = game.result.winner === 'w' ? 'White' : game.result.winner === 'b' ? 'Gold' : null;
  const reason = {
    citadel: 'the king reached the citadel',
    'bare-both': 'both sides are bare',
    'bare-king': 'bare king',
    checkmate: 'checkmate',
    stalemate: 'stalemate',
    resign: 'resignation',
    timeout: 'time out'
  }[game.result.reason] || game.result.reason;
  overTitle.textContent = who ? `${who} wins` : 'Draw';
  overSub.textContent = reason;
  const hostControls = mode === 'host';
  rematchCfg.hidden = !hostControls;
  overCfg.hidden = true;
  if (hostControls) {
    $('rTimerOn').checked = timer.on;
    $('rBaseMin').value = timer.baseMin;
    $('rIncSec').value = timer.incSec;
    syncTimerInputs($('rTimerOn'), $('rBaseMin'), $('rIncSec'));
  } else if (mode === 'guest') {
    overCfg.hidden = false;
    overCfg.textContent = timer.on ? `Clock: ${timer.baseMin} min + ${timer.incSec} s per move` : 'No clock';
    overCfg.textContent += ' \u00b7 colours swap on rematch';
  }
  overlayEl.hidden = false;
  updateHud();
}

function hideOverlay() { overlayEl.hidden = true; }

function resetGame() {
  game = new Game();
  selected = null;
  legal = [];
  lastMove = null;
  pending = false;
  clearTimeout(pendingTimer);
  hideOverlay();
  render();
}

function setSheetMsg(t) { sheetMsg.textContent = t; }

function openSheet() {
  sheetEl.hidden = false;
  sheetMain.hidden = false;
  waitBox.hidden = true;
  nameInput.value = playerName || nameInput.value;
  renderRecent();
  resumeBtn.hidden = !savedHost;
}

function hideSheet() { sheetEl.hidden = true; closeLobby(); }

function renderLobby() {
  if (!lobbyList || !lobbyMsg) return;
  lobbyList.textContent = '';
  if (lobbyError) { lobbyMsg.textContent = lobbyError; return; }
  if (!lobbyReady) { lobbyMsg.textContent = lobbyClient ? 'Looking for open games\u2026' : ''; return; }
  const rooms = [...lobbyRooms.values()].filter(r => !r.full).sort((a, b) => b.at - a.at).slice(0, 20);
  if (!rooms.length) { lobbyMsg.textContent = 'No open games right now.'; return; }
  lobbyMsg.textContent = '';
  for (const r of rooms) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lobby-row';
    const left = document.createElement('span');
    left.className = 'lobby-left';
    const nm = document.createElement('strong');
    nm.textContent = r.host || 'Host';
    const meta = document.createElement('small');
    const cfg = r.timed ? `${r.baseMin} min + ${r.incSec} s` : 'No clock';
    meta.textContent = cfg + (r.pass ? ' \u00b7 password' : '');
    left.append(nm, meta);
    const join = document.createElement('span');
    join.className = 'lobby-join';
    join.textContent = 'Join';
    row.append(left, join);
    row.addEventListener('click', () => { closeLobby(); startGuest(r.code); });
    lobbyList.appendChild(row);
  }
}

async function openLobby() {
  if (lobbyClient) return;
  const seq = ++lobbySeq;
  lobbyReady = false;
  lobbyError = '';
  renderLobby();
  let c;
  try { c = await connectBroker(0, mqttOverride); }
  catch { if (seq === lobbySeq) { lobbyError = 'Open games unavailable. Use a code or invite link.'; renderLobby(); } return; }
  if (seq !== lobbySeq) { try { c.end(true); } catch {} return; }
  lobbyClient = c;
  c.on('error', () => {});
  c.on('message', (topic, payload) => {
    if (topic !== LOBBY_TOPIC) return;
    let m;
    try { m = JSON.parse(payload.toString()); } catch { return; }
    if (m.t === 'room' && isValidCode(m.code)) {
      if (m.full) lobbyRooms.delete(m.code);
      else {
        lobbyRooms.set(m.code, {
          code: m.code,
          host: sanitizeName(m.host) || 'Host',
          timed: !!m.timed,
          baseMin: Math.min(180, Math.max(1, Number(m.baseMin) || 10)),
          incSec: Math.min(900, Math.max(0, Number(m.incSec) || 0)),
          pass: !!m.pass,
          at: Date.now()
        });
      }
      renderLobby();
    } else if (m.t === 'room-close' && isValidCode(m.code)) {
      lobbyRooms.delete(m.code);
      renderLobby();
    }
  });
  c.on('connect', () => { c.subscribe(LOBBY_TOPIC, { qos: 0 }, () => {}); });
  c.subscribe(LOBBY_TOPIC, { qos: 0 }, err => {
    if (err) lobbyError = 'Open games unavailable. Use a code or invite link.';
    else lobbyReady = true;
    renderLobby();
  });
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [k, v] of lobbyRooms) {
      if (now - v.at > 12000) { lobbyRooms.delete(k); changed = true; }
    }
    if (changed) renderLobby();
  }, 2000);
  renderLobby();
}

function closeLobby() {
  lobbySeq++;
  clearInterval(lobbyTimer);
  lobbyTimer = null;
  if (lobbyClient) { try { lobbyClient.end(true); } catch {} }
  lobbyClient = null;
  lobbyReady = false;
  lobbyError = '';
  lobbyRooms.clear();
  renderLobby();
}

function announceLobby() {
  if (!hostLobbyClient || mode !== 'host' || !roomCode) return;
  const full = connected && Date.now() - guestSeen < 20000;
  hostLobbyClient.publish(LOBBY_TOPIC, JSON.stringify({
    t: 'room', v: 2, code: roomCode, host: names.host || playerName,
    timed: timer.on, baseMin: timer.baseMin, incSec: timer.incSec,
    pass: !!roomPassHash, full
  }), { qos: 0 });
}

async function startHostLobby() {
  stopHostLobby(false);
  const code = roomCode;
  if (!code) return;
  let c;
  try { c = await connectBroker(0, mqttOverride); } catch { return; }
  if (mode !== 'host' || roomCode !== code) { try { c.end(true); } catch {} return; }
  c.on('error', () => {});
  hostLobbyClient = c;
  announceLobby();
  clearInterval(hostLobbyTimer);
  hostLobbyTimer = setInterval(announceLobby, 4000);
}

function stopHostLobby(close) {
  clearInterval(hostLobbyTimer);
  hostLobbyTimer = null;
  if (hostLobbyClient) {
    if (close && roomCode) {
      try { hostLobbyClient.publish(LOBBY_TOPIC, JSON.stringify({ t: 'room-close', v: 2, code: roomCode }), { qos: 0 }); } catch {}
    }
    try { hostLobbyClient.end(true); } catch {}
  }
  hostLobbyClient = null;
}

function cancelCreate() {
  if (mode === 'host') clearHostSave();
  resetToIdle();
  hideSheet();
}

function closeMenu() { menuEl.hidden = true; }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}

function inviteLink() {
  return location.origin + location.pathname + '#r=' + roomCode;
}

function syncTimerInputs(onEl, baseEl, incEl) {
  const off = !onEl.checked;
  baseEl.disabled = off;
  incEl.disabled = off;
  baseEl.parentElement.classList.toggle('dim', off);
  incEl.parentElement.classList.toggle('dim', off);
}

function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}

function tone(freq, dur, type, vol, delay) {
  if (!actx) return;
  const t0 = actx.currentTime + (delay || 0);
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.035, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(actx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function playSound(kind) {
  if (!soundOn) return;
  initAudio();
  if (!actx) return;
  if (kind === 'move') tone(340, 0.07, 'triangle', 0.03);
  else if (kind === 'capture') { tone(190, 0.1, 'square', 0.025); tone(140, 0.12, 'sine', 0.03, 0.02); }
  else if (kind === 'check') { tone(660, 0.09, 'sine', 0.035); tone(880, 0.12, 'sine', 0.03, 0.09); }
  else if (kind === 'end') { tone(220, 0.18, 'sine', 0.04); tone(330, 0.22, 'sine', 0.03, 0.1); tone(440, 0.3, 'sine', 0.025, 0.2); }
}

function soundForMove() {
  const h = game.history[game.history.length - 1];
  if (!h) return;
  if (game.result) { playSound('end'); return; }
  if (game.isInCheck(game.turn)) { playSound('check'); return; }
  playSound(h.captured ? 'capture' : 'move');
}

function animateMove(mv) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (mode === 'idle' || !started) return;
  const fromEl = boardEl.querySelector(`[data-f="${mv.from.f}"][data-r="${mv.from.r}"]`);
  const toEl = boardEl.querySelector(`[data-f="${mv.to.f}"][data-r="${mv.to.r}"]`);
  if (!fromEl || !toEl || toEl.classList.contains('citadel')) return;
  const destPiece = toEl.querySelector('.piece img');
  if (!destPiece) return;
  if (mv.swap) {
    slide(fromEl, toEl, destPiece.src);
    return;
  }
  slide(fromEl, toEl, destPiece.src);
}

function slide(fromEl, toEl, src) {
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ghost = document.createElement('img');
  ghost.src = src;
  ghost.className = 'slide-ghost';
  ghost.style.left = a.left + 'px';
  ghost.style.top = a.top + 'px';
  ghost.style.width = a.width + 'px';
  ghost.style.height = a.height + 'px';
  document.body.appendChild(ghost);
  const destPiece = toEl.querySelector('.piece');
  if (destPiece) destPiece.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    ghost.style.left = b.left + 'px';
    ghost.style.top = b.top + 'px';
  });
  setTimeout(() => {
    ghost.remove();
    if (destPiece && destPiece.isConnected) destPiece.style.visibility = '';
  }, 190);
}

function sq(f, r) {
  if (f === -1 || f === 11) return 'cit';
  return 'abcdefghijk'[f] + (r + 1);
}

function renderDrawer() {
  if (!drawerOpen) return;
  if (mode === 'local') playersLine.textContent = 'Local game';
  else if (mode === 'idle') playersLine.textContent = '';
  else playersLine.textContent = `${names.host || 'Host'} (${colorName(hostColor)}) vs ${names.guest || 'Guest'} (${colorName(other(hostColor))})`;
  const capW = [];
  const capB = [];
  for (const h of game.history) {
    if (!h.captured) continue;
    (h.piece.color === 'w' ? capW : capB).push(h.captured);
  }
  const imgs = arr => arr.length ? arr.map(p => `<img src="assets/pieces/${imageName(p.type)}_${p.color === 'w' ? 'white' : 'black'}.webp" alt="">`).join('') : '\u2014';
  capturedEl.innerHTML = `<div class="cap-group">White took: ${imgs(capW)}</div><div class="cap-group">Gold took: ${imgs(capB)}</div>`;
  moveListEl.innerHTML = game.history.map((h, i) => {
    const m = h.move;
    const p = isPawnType(h.piece.type) ? '' : h.piece.type;
    const note = m.swap ? 'K \u2194 swap' : `${p}${sq(m.from.f, m.from.r)}${h.captured ? '\u00d7' : '-'}${sq(m.to.f, m.to.r)}${h.promotedTo ? '=' + h.promotedTo : ''}`;
    return `<div class="mrow"><span class="mno">${i + 1}</span><span class="${h.piece.color === 'w' ? 'mwhite' : 'mgold'}">${note}</span></div>`;
  }).join('');
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function renderDemo() {
  const g = new Game();
  g.board.clear();
  g.turn = 'w';
  g.set(5, 4, { type: demoType, color: 'w' });
  if (demoBlocked) {
    for (const [df, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const f = 5 + df, r = 4 + dr;
      if (f >= 0 && f <= 10 && r >= 0 && r <= 9) g.set(f, r, { type: 'P_P', color: 'b' });
    }
  }
  const moves = g.pseudoMovesFor(5, 4);
  const byTo = new Map();
  for (const m of moves) byTo.set(key(m.f, m.r), m);
  demoBoard.innerHTML = '';
  for (let r = 9; r >= 0; r--) {
    for (let f = 0; f <= 10; f++) {
      const el = document.createElement('div');
      const k = key(f, r);
      let cls = 'square ' + ((f + r) % 2 === 0 ? 'light' : 'dark');
      if (f === 5 && r === 4) cls += ' selected';
      const mv = byTo.get(k);
      if (mv) cls += mv.capture ? ' capture' : ' legal';
      el.className = cls;
      el.style.gridColumn = f + 1;
      el.style.gridRow = 10 - r;
      const p = g.get(f, r);
      if (p) el.innerHTML = pieceHTML(p);
      demoBoard.appendChild(el);
    }
  }
  howName.textContent = PIECE_LABEL[demoType] || demoType;
  howRule.textContent = ruleText(demoType);
}

function ruleText(t) {
  const R = {
    K: 'One square in any direction. Royal: losing it ends the game.',
    X: 'Moves like a King but is not royal.',
    F: 'One square diagonally.',
    W: 'One square horizontally or vertically.',
    G: 'One diagonal step onto an empty square, then at least three squares horizontally or vertically in a straight line; the path must be clear.',
    S: 'Slides diagonally, but at least two squares; the first square must be empty.',
    N: 'Jumps in an L; blockers never stop it.',
    R: 'Slides any distance horizontally or vertically; the first piece stops it.',
    E: 'Jumps exactly two squares diagonally; ignores blockers.',
    C: 'Jumps three-and-one; ignores blockers.',
    D: 'Jumps exactly two squares horizontally or vertically; ignores blockers.'
  };
  if (isPawnType(t)) {
    const target = UPGRADE[t] || 'F';
    return `Moves one square forward, captures diagonally forward. Promotes to ${PIECE_LABEL[target]} on the last rank.`;
  }
  return R[t] || '';
}

function buildPieceStrip() {
  pieceStrip.innerHTML = '';
  const types = ['K','X','F','W','G','S','N','R','E','C','D','P_P','P_D','P_C','P_E','P_F','P_K','P_W','P_G','P_S','P_N','P_R'];
  for (const t of types) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'piece-chip' + (t === demoType ? ' sel' : '');
    b.title = PIECE_LABEL[t] || t;
    b.innerHTML = `<img src="assets/pieces/${imageName(t)}_white.webp" alt="">` + (isPawnType(t) ? '<i class="chip-dot"></i>' : '');
    b.addEventListener('click', () => {
      demoType = t;
      for (const c of pieceStrip.children) c.classList.toggle('sel', c === b);
      renderDemo();
    });
    pieceStrip.appendChild(b);
  }
}

function openHowto() {
  howReturn = !sheetEl.hidden;
  closeLobby();
  sheetEl.hidden = true;
  howtoEl.hidden = false;
  demoStart = performance.now();
  demoBlocked = false;
  buildPieceStrip();
  renderDemo();
  howCount.textContent = 'Switching in 5.0s';
  clearInterval(demoTimer);
  demoTimer = setInterval(() => {
    if (howtoEl.hidden) return;
    const elapsed = (performance.now() - demoStart) / 1000;
    const phase = Math.floor(elapsed / 5) % 2 === 1;
    if (phase !== demoBlocked) { demoBlocked = phase; renderDemo(); }
    howCount.textContent = `Switching in ${(5 - (elapsed % 5)).toFixed(1)}s`;
  }, 200);
}

function closeHowto() {
  howtoEl.hidden = true;
  clearInterval(demoTimer);
  demoTimer = null;
  if (howReturn) openSheet();
}

function setPassRow(show) { passRow.hidden = !show; }

boardEl.addEventListener('click', e => {
  const el = e.target.closest('.square');
  if (!el) return;
  onSquare(+el.dataset.f, +el.dataset.r);
});

$('localBtn').addEventListener('click', startLocal);
$('createBtn').addEventListener('click', createRoom);
$('joinBtn').addEventListener('click', () => startGuest(codeInput.value));
$('passBtn').addEventListener('click', async () => {
  const p = joinPass.value.trim();
  if (!p) { setSheetMsg('Enter the room password.'); return; }
  guestPassHash = await sha256Hex(p);
  await sendJoin(guestPassHash);
});
$('sheetClose').addEventListener('click', () => {
  if (mode === 'guest' && !connected) {
    setSheetMsg('Finish joining first, or reopen the invite link.');
    return;
  }
  if (!waitBox.hidden) cancelCreate();
  else hideSheet();
});
$('cancelWaitBtn').addEventListener('click', cancelCreate);
$('copyLinkBtn').addEventListener('click', async () => {
  const ok = await copyText(inviteLink());
  waitMsg.textContent = ok ? 'Invite link copied.' : 'Copy failed \u2014 select the code.';
});
$('copyMenuBtn').addEventListener('click', async () => {
  closeMenu();
  if (!roomCode) return;
  const ok = await copyText(inviteLink());
  if (!ok) statusEl.textContent = 'Copy failed';
});
$('resignBtn').addEventListener('click', () => {
  closeMenu();
  if (!started || game.result) return;
  if (mode === 'host') {
    game.result = { winner: other(myColor), reason: 'resign' };
    publishState(null);
    render();
    showOverlay();
    saveHost();
  } else if (mode === 'guest') {
    net.send({ t: 'resign', v: 2, id: myId, secret: guestSecret });
    pending = true;
    updateHud();
  }
});
$('leaveBtn').addEventListener('click', () => {
  closeMenu();
  hideOverlay();
  if (mode === 'host') clearHostSave();
  savedHost = loadHostSave();
  resetToIdle();
  hideSheet();
});
$('rematchBtn').addEventListener('click', () => {
  if (mode === 'local') { resetGame(); return; }
  if (mode === 'host') { hostRematch(); return; }
  if (mode === 'guest') {
    net.send({ t: 'rematch', v: 2, id: myId, secret: guestSecret });
    overSub.textContent = 'Rematch requested\u2026';
  }
});
$('closeOverBtn').addEventListener('click', hideOverlay);
$('playBtn').addEventListener('click', () => { setSheetMsg(''); setPassRow(false); openSheet(); openLobby(); });
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); menuEl.hidden = !menuEl.hidden; });
$('movesBtn').addEventListener('click', () => {
  drawerOpen = !drawerOpen;
  drawerEl.hidden = !drawerOpen;
  renderDrawer();
});
$('drawerClose').addEventListener('click', () => { drawerOpen = false; drawerEl.hidden = true; });
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('timuria_sound', soundOn ? '1' : '0');
  soundBtn.textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
  initAudio();
  if (soundOn) playSound('move');
});
$('fullBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {}
});
$('howBtn').addEventListener('click', openHowto);
$('howClose').addEventListener('click', closeHowto);
$('resumeBtn').addEventListener('click', resumeHost);
$('timerOn').addEventListener('change', () => syncTimerInputs($('timerOn'), $('baseMin'), $('incSec')));
$('rTimerOn').addEventListener('change', () => syncTimerInputs($('rTimerOn'), $('rBaseMin'), $('rIncSec')));
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') startGuest(codeInput.value); });
joinPass.addEventListener('keydown', e => { if (e.key === 'Enter') $('passBtn').click(); });
document.addEventListener('click', e => {
  if (!menuEl.hidden && !menuEl.contains(e.target) && e.target !== menuBtn) closeMenu();
});
document.addEventListener('pointerdown', initAudio, { once: true });

soundBtn.textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
syncTimerInputs($('timerOn'), $('baseMin'), $('incSec'));
renderRecent();
savedHost = loadHostSave();
resumeBtn.hidden = !savedHost;
buildBoard();
render();

const hashMatch = location.hash.match(/r=([A-Za-z0-9]+)/);
if (hashMatch) {
  const code = hashMatch[1].toUpperCase();
  codeInput.value = code;
  if (isValidCode(code)) {
    if (playerName) startGuest(code);
    else {
      pendingJoinCode = code;
      openSheet();
      setSheetMsg('Enter your name, then Join.');
    }
  }
}
