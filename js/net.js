export const BROKERS = [
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/' }
];

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randId(n = 12) {
  let s = '';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function makeCode(brokerIndex) {
  return String(brokerIndex) + randId(12);
}

export function codeBroker(code) {
  return Number(code[0]);
}

export function isValidCode(code) {
  return typeof code === 'string' && /^[0-2][A-Z2-9]{12}$/.test(code);
}

export function brokerUrl(index, override) {
  if (override) return override;
  return BROKERS[index] ? BROKERS[index].url : null;
}

export function connectBroker(index, override) {
  const mqtt = globalThis.mqtt;
  const url = brokerUrl(index, override);
  return new Promise((resolve, reject) => {
    if (!mqtt) return reject(new Error('mqtt missing'));
    if (!url) return reject(new Error('bad broker'));
    const client = mqtt.connect(url, {
      clientId: 'tm_' + randId(14),
      clean: true,
      connectTimeout: 7000,
      reconnectPeriod: 1500,
      keepalive: 20,
      protocolVersion: 4
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { client.end(true); } catch {}
      reject(new Error('timeout ' + url));
    }, 8500);
    const onConnect = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.removeListener('error', onError);
      resolve(client);
    };
    const onError = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.end(true); } catch {}
      reject(err);
    };
    client.once('connect', onConnect);
    client.once('error', onError);
  });
}

export class NetRoom {
  constructor(code, role, client, override) {
    this.code = code;
    this.role = role;
    this.client = client;
    this.topic = 'timuria/v1/' + code;
    this.override = override;
    this.onMessage = null;
    this.onStatus = null;
    this.onReconnect = null;
    this.closed = false;
  }

  subscribe() {
    return new Promise((resolve, reject) => {
      this.client.subscribe(this.topic, { qos: 1 }, (err) => err ? reject(err) : resolve());
    });
  }

  async start() {
    this.client.on('message', (topic, payload) => {
      if (topic !== this.topic) return;
      let msg;
      try { msg = JSON.parse(payload.toString()); } catch { return; }
      if (this.onMessage) this.onMessage(msg);
    });
    this.client.on('connect', () => {
      this.subscribe()
        .then(() => {
          if (this.onStatus) this.onStatus('connected');
          if (this.onReconnect) this.onReconnect();
        })
        .catch(() => this.onStatus && this.onStatus('error'));
    });
    this.client.on('close', () => { if (this.onStatus) this.onStatus('closed'); });
    this.client.on('offline', () => { if (this.onStatus) this.onStatus('closed'); });
    this.client.on('reconnect', () => { if (this.onStatus) this.onStatus('reconnecting'); });
    this.client.on('error', () => { if (this.onStatus) this.onStatus('error'); });
    await this.subscribe();
  }

  send(obj) {
    if (!this.client || this.closed) return;
    this.client.publish(this.topic, JSON.stringify(obj), { qos: 1 });
  }

  close() {
    this.closed = true;
    try { this.client.end(true); } catch {}
  }
}
