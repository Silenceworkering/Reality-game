import http from 'node:http';
import { openDatabase } from './database.mjs';
import { randomInt, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { furniture, validName } from '../../packages/shared/game.mjs';
import { choices, chapters, jobs, canChoose } from '../../packages/shared/story.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../web/public');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
export async function createGame({ database = ':memory:', secure = false, origin } = {}) {
  const db = await openDatabase(database);
  const identity = db.postgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY';
  await db.transaction(async () => {
    await db.exec(`
    CREATE TABLE IF NOT EXISTS users(id ${identity}, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, wallet INTEGER NOT NULL DEFAULT 5000 CHECK(wallet>=0), house INTEGER NOT NULL, apartment INTEGER NOT NULL, layout TEXT NOT NULL DEFAULT '{"sofa":null}', UNIQUE(house,apartment));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger(id ${identity},user INTEGER REFERENCES users(id),operation TEXT NOT NULL,delta INTEGER NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0),created BIGINT NOT NULL,UNIQUE(user,operation));
    CREATE TABLE IF NOT EXISTS dialogues(user INTEGER REFERENCES users(id),choice TEXT NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(user,choice));
    CREATE TABLE IF NOT EXISTS job_attempts(id TEXT PRIMARY KEY,user INTEGER REFERENCES users(id),job TEXT NOT NULL,sequence TEXT NOT NULL,started BIGINT NOT NULL,completed BIGINT);
    CREATE TABLE IF NOT EXISTS actions(user INTEGER REFERENCES users(id),key TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));`);
  });
  const limits = new Map();
  const transaction = db.transaction;
  const snapshot = async id => { const u = await db.prepare('SELECT id,name,wallet,house,apartment,layout FROM users WHERE id=?').get(id); return { ...u, activeJob: await db.prepare('SELECT id,job,sequence,started FROM job_attempts WHERE user=? AND completed IS NULL AND started>? ORDER BY started DESC LIMIT 1').get(id,Date.now()-600000) || null, layout: JSON.parse(u.layout), history: await db.prepare('SELECT choice,created FROM dialogues WHERE user=? ORDER BY created').all(id), ledger: await db.prepare('SELECT delta,balance,operation FROM ledger WHERE user=? ORDER BY id DESC LIMIT 20').all(id) }; };
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/v1/content' && req.method==='GET') return send(200,{choices,chapters,jobs});
      if (url.pathname === '/health') { await db.prepare('SELECT 1 AS ok').get(); return send(200, { status: 'ok', version:'0.3.0', storage:db.postgres?'postgresql':'sqlite' }); }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw fail(405,'Метод недоступен');
        const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
        const file = resolve(root, '.' + path);
        if (!file.startsWith(root + '/') || !existsSync(file)) throw fail(404,'Не найдено');
        res.writeHead(200, { 'Content-Type': ({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[extname(file)] || 'application/octet-stream'), 'Cache-Control':'no-cache' }); return res.end(readFileSync(file));
      }
      const now = Date.now();
      if (limits.size > 10000) for (const [key,value] of limits) if(value.until<now) limits.delete(key);
      const ip = req.socket.remoteAddress;
      const bucketKey = ip + (url.pathname.startsWith('/api/v1/auth') ? ':auth' : ':api');
      const bucket = limits.get(bucketKey) || { count:0, until:now+60000 };
      if (bucket.until < now) { bucket.count=0; bucket.until=now+60000; }
      bucket.count++; limits.set(bucketKey,bucket);
      if (bucket.count > (bucketKey.endsWith(':auth') ? 15 : 120)) throw fail(429,'Слишком часто. Попробуй через минуту.');
      let body = {};
      if (req.method === 'POST') {
        const expectedOrigin = origin || (process.env.RENDER_EXTERNAL_URL || `http://${req.headers.host}`);
        if (req.headers.origin && req.headers.origin !== expectedOrigin) throw fail(403,'Чужой источник запроса');
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415,'Нужен JSON');
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw fail(413,'Запрос слишком большой'); }
        try { body = JSON.parse(raw); } catch { throw fail(400,'Некорректный JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400,'Некорректный запрос');
      }
      if (req.method === 'POST' && ['/api/v1/auth/register','/api/v1/auth/login'].includes(url.pathname)) {
        if (!validName(body.name) || typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) throw fail(400,'Ник: 3–24 буквы или цифры. Пароль: 10–128 символов.');
        let user;
        if (url.pathname.endsWith('register')) {
          if (await db.prepare('SELECT id FROM users WHERE name=?').get(body.name)) throw fail(409,'Этот ник уже живёт здесь');
          const salt = randomBytes(16).toString('hex'); const password = scryptSync(body.password,salt,64).toString('hex');
          user = await transaction(async () => { const count = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n; const result = await db.prepare('INSERT INTO users(name,salt,password,house,apartment) VALUES(?,?,?,?,?) RETURNING id').get(body.name,salt,password,Math.floor(count/36)+1,count%36+1); const id=Number(result.id); await db.prepare('INSERT INTO ledger(user,operation,delta,balance,created) VALUES(?,?,?,?,?)').run(id,'welcome',5000,5000,now); return {id}; });
        } else {
          user = await db.prepare('SELECT * FROM users WHERE name=?').get(body.name);
          const candidate = scryptSync(body.password,user?.salt || 'unknown-user',64);
          if (!user || !timingSafeEqual(candidate,Buffer.from(user.password,'hex'))) throw fail(401,'Неверный ник или пароль');
        }
        const token = randomBytes(32).toString('hex'); await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,now+30*86400000);
        res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure?'; Secure':''}`); return send(200,await snapshot(user.id));
      }
      const token = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);
      const session = token && await db.prepare('SELECT user FROM sessions WHERE token=? AND expires>?').get(hash(token),now);
      if (!session) throw fail(401,'Сначала заселись или войди');
      const id = session.user;
      if (req.method === 'GET' && url.pathname === '/api/v1/me') return send(200,await snapshot(id));
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') { await db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return send(200,{ok:true}); }
      if (req.method === 'POST' && url.pathname === '/api/v1/action') {
        if (typeof body.key !== 'string' || !/^[\w-]{8,80}$/.test(body.key)) throw fail(400,'Нужен ключ операции');
        const result = await transaction(async () => {
          const cached = await db.prepare('SELECT result FROM actions WHERE user=? AND key=?').get(id,body.key);
          if (cached) return JSON.parse(cached.result);
          const user = await snapshot(id);
          if (body.type === 'buy-sofa') {
            if (user.layout.sofa) throw fail(409,'Диван уже есть');
            const price=furniture.sofa.price;
            if(user.wallet<price) throw fail(409,'Не хватает рублей');
            await db.prepare('UPDATE users SET wallet=wallet-?,layout=? WHERE id=?').run(price,JSON.stringify({sofa:'left'}),id);
            await db.prepare('INSERT INTO ledger(user,operation,delta,balance,created) VALUES(?,?,?,?,?)').run(id,body.key,-price,user.wallet-price,now);
          } else if (body.type === 'move-sofa') {
            if(!user.layout.sofa || !['left','right'].includes(body.position)) throw fail(400,'Неверное место');
            await db.prepare('UPDATE users SET layout=? WHERE id=?').run(JSON.stringify({sofa:body.position}),id);
          } else if (body.type === 'job-start') {
            if (!Object.hasOwn(jobs,body.job)) throw fail(400,'Неизвестная работа');
            const previous=await db.prepare('SELECT started FROM job_attempts WHERE user=? AND job=? ORDER BY started DESC LIMIT 1').get(id,body.job);
            if(previous && now-previous.started<90000) throw fail(409,'Следующий заказ появится через полторы минуты после начала предыдущего.');
            const sequence=Array.from({length:4},()=>randomInt(1,7));
            await db.prepare('INSERT INTO job_attempts(id,user,job,sequence,started) VALUES(?,?,?,?,?)').run(body.key,id,body.job,JSON.stringify(sequence),now);
          } else if (body.type === 'job-finish') {
            const attempt=await db.prepare('SELECT * FROM job_attempts WHERE id=? AND user=?').get(body.attempt,id);
            if(!attempt || attempt.completed) throw fail(409,'Заказ уже закрыт или не найден');
            if(now-attempt.started<10000) throw fail(409,'Сверь заказ ещё раз. Работа занимает хотя бы 10 секунд.');
            if(now-attempt.started>600000) throw fail(409,'Заказ истёк. Возьми новый.');
            if(!Array.isArray(body.answer)||JSON.stringify(body.answer)!==attempt.sequence) throw fail(400,'Порядок не совпал с нарядом');
            const reward=jobs[attempt.job].reward;
            await db.prepare('UPDATE job_attempts SET completed=? WHERE id=?').run(now,attempt.id);
            await db.prepare('UPDATE users SET wallet=wallet+? WHERE id=?').run(reward,id);
            await db.prepare('INSERT INTO ledger(user,operation,delta,balance,created) VALUES(?,?,?,?,?)').run(id,body.key,reward,user.wallet+reward,now);
          } else if (body.type === 'dialogue') {
            if(!Object.hasOwn(choices,body.choice)) throw fail(400,'Неизвестная реплика');
            const node=choices[body.choice];
            if(!canChoose(body.choice,user.history)) throw fail(409,'Этот выбор уже сделан или ещё недоступен');
            await db.prepare('INSERT INTO dialogues VALUES(?,?,?)').run(id,body.choice,now);
            if(node.reward){await db.prepare('UPDATE users SET wallet=wallet+? WHERE id=?').run(node.reward,id);await db.prepare('INSERT INTO ledger(user,operation,delta,balance,created) VALUES(?,?,?,?,?)').run(id,body.key,node.reward,user.wallet+node.reward,now);}
          } else throw fail(400,'Неизвестное действие');
          const state=await snapshot(id); await db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id,body.key,JSON.stringify(state)); return state;
        }); return send(200,result);
      }
      throw fail(404,'Не найдено');
    } catch(error) { if(!error.status) console.error('Request failed:', error.code || 'internal'); if(error.code==='23505') error=fail(409,'Этот ник уже живёт здесь'); send(error.status || 500,{ error:{ message:error.status ? error.message : 'Ошибка сервера', code:error.status || 500 } }); }
  });
  return { server, db, close:()=>new Promise((resolve,reject)=>server.close(()=>{db.close().then(resolve,reject);})) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const game=await createGame({database:process.env.DATABASE_URL || process.env.DATABASE_PATH || './data/game.sqlite',secure:process.env.COOKIE_SECURE==='true',origin:process.env.ORIGIN});
  game.server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',()=>console.log('Ну живи · порт '+(process.env.PORT || 3000)));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{await game.close();process.exit(0);});
}
