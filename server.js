const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

// Load .env file if present (no dotenv dependency needed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g,'');
  });
}

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'quarter-secret-key-change-in-prod';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const DB_FILE  = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── JSON store ────────────────────────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function nextId(rows) { return rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1; }

const db = {
  all(t)             { return readDB()[t] || []; },
  find(t, fn)        { return (readDB()[t] || []).filter(fn); },
  findOne(t, fn)     { return (readDB()[t] || []).find(fn) || null; },
  insert(t, rec)     {
    const data = readDB();
    if (!data[t]) data[t] = [];
    const row = { id: nextId(data[t]), ...rec, created_at: new Date().toISOString() };
    data[t].push(row); writeDB(data); return row;
  },
  update(t, fn, ch)  {
    const data = readDB();
    data[t] = (data[t] || []).map(r => fn(r) ? { ...r, ...ch } : r);
    writeDB(data);
  },
  remove(t, fn)      {
    const data = readDB();
    data[t] = (data[t] || []).filter(r => !fn(r));
    writeDB(data);
  },
};

// ── Migrations ────────────────────────────────────────────────────────────────
function migrate() {
  const data = readDB();
  let dirty = false;

  // Ensure all tables exist
  for (const t of ['users','lists','list_items','polls','poll_options','user_votes']) {
    if (!data[t]) { data[t] = []; dirty = true; }
  }

  // Add is_revealed to old items
  if (data.list_items.some(i => i.is_revealed === undefined)) {
    data.list_items = data.list_items.map(i => ({ ...i, is_revealed: i.is_revealed ?? (i.rank <= 10) }));
    dirty = true;
  }

  // Add google_id to old users
  if (data.users.some(u => u.google_id === undefined)) {
    data.users = data.users.map(u => ({ google_id: null, ...u }));
    dirty = true;
  }

  // Add is_featured to lists
  if (data.lists.some(l => l.is_featured === undefined)) {
    data.lists = data.lists.map(l => ({ ...l, is_featured: l.is_featured ?? false }));
    dirty = true;
  }

  // Add profile fields to users
  if (data.users.some(u => u.first_name === undefined)) {
    data.users = data.users.map(u => ({
      ...u,
      first_name: u.first_name ?? '',
      last_name:  u.last_name  ?? '',
      bio:        u.bio        ?? '',
      is_public:  u.is_public  ?? true,
    }));
    dirty = true;
  }

  // Upgrade weak default admin password
  const adminUser = data.users.find(u => u.is_admin);
  if (adminUser?.password_hash && bcrypt.compareSync('admin123', adminUser.password_hash)) {
    data.users = data.users.map(u =>
      u.id === adminUser.id ? { ...u, password_hash: bcrypt.hashSync('Admin@TheQuarter1', 10) } : u
    );
    dirty = true;
    console.log('✓ Admin password upgraded  →  Admin@TheQuarter1');
  }

  // Migrate list_items to use list_id (create default lists if needed)
  if (data.list_items.length > 0 && data.list_items.some(i => !i.list_id)) {
    const adminId = data.users.find(u => u.is_admin)?.id || 1;
    const ts = new Date().toISOString();

    for (const cat of ['games', 'films']) {
      if (data.lists.some(l => l.category === cat)) continue;
      const list = {
        id: nextId(data.lists),
        title: "The Quarter's 25", category: cat,
        author_name: 'The Quarter',
        description: cat === 'games'
          ? 'Twenty-five games that pushed the boundaries of what interactive art can be.'
          : 'Twenty-five films that captured something essential about the human experience.',
        is_active: true, created_by: adminId, created_at: ts,
      };
      data.lists.push(list);
    }

    const gList = data.lists.find(l => l.category === 'games');
    const fList = data.lists.find(l => l.category === 'films');
    data.list_items = data.list_items.map(i => ({
      ...i,
      list_id: i.list_id || (i.category === 'games' ? gList?.id : fList?.id),
    }));
    dirty = true;
    console.log('✓ Migration: list_items linked to lists');
  }

  if (dirty) writeDB(data);
}
migrate();

// ── Seed data ─────────────────────────────────────────────────────────────────
const GAMES = [
  { rank:1,  title:'Elden Ring',                               year:2022, genre:'Action RPG',      description:'FromSoftware\'s open-world masterpiece — a vast, brutal mythology played through the fingers.' },
  { rank:2,  title:'The Witcher 3: Wild Hunt',                 year:2015, genre:'RPG',              description:'The gold standard of open-world RPGs, with a story that treats its world as alive.' },
  { rank:3,  title:'Red Dead Redemption 2',                    year:2018, genre:'Action-Adventure', description:'Rockstar\'s cinematic swan song for the American frontier — nothing matches its weight.' },
  { rank:4,  title:'The Legend of Zelda: Breath of the Wild',  year:2017, genre:'Action-Adventure', description:'A revolutionary open world built entirely around player curiosity and emergent physics.' },
  { rank:5,  title:'Dark Souls III',                           year:2016, genre:'Action RPG',       description:'The most refined entry in the Soulsborne lineage — punishing, beautiful, and fair.' },
  { rank:6,  title:'God of War (2018)',                        year:2018, genre:'Action-Adventure', description:'A reinvention that made Kratos a father and turned spectacle into something genuinely moving.' },
  { rank:7,  title:'Half-Life 2',                              year:2004, genre:'FPS',              description:'The template for environmental storytelling in games — still unmatched twenty years on.' },
  { rank:8,  title:'Portal 2',                                 year:2011, genre:'Puzzle',           description:'Brilliant, funny, and endlessly inventive. The perfect video game puzzle box.' },
  { rank:9,  title:'Outer Wilds',                              year:2019, genre:'Exploration',      description:'A solar system mystery told through curiosity alone. One of the great gaming revelations.' },
  { rank:10, title:'Disco Elysium',                            year:2019, genre:'RPG',              description:'The most extraordinary piece of writing in any game — a detective story about ideology itself.' },
  { rank:11, title:'Hollow Knight',                            year:2017, genre:'Metroidvania',     description:'A handcrafted underground kingdom of astonishing depth, atmosphere, and precision.' },
  { rank:12, title:'Bloodborne',                               year:2015, genre:'Action RPG',       description:'Gothic horror as interactive art. FromSoftware at their most haunting and focused.' },
  { rank:13, title:'Mass Effect 2',                            year:2010, genre:'RPG',              description:'The definitive squad RPG — characters so well-written you\'d die for them (and you do).' },
  { rank:14, title:'Hades',                                    year:2020, genre:'Roguelike',        description:'The first roguelike where the narrative is the reason to keep playing, not just the combat.' },
  { rank:15, title:'Sekiro: Shadows Die Twice',                year:2019, genre:'Action',           description:'Samurai combat as dialogue — the most demanding and rewarding back-and-forth FromSoftware made.' },
  { rank:16, title:'Shadow of the Colossus',                   year:2005, genre:'Action-Adventure', description:'Sixteen encounters that define loneliness, scale, and the cost of obsession.' },
  { rank:17, title:'BioShock',                                 year:2007, genre:'FPS',              description:'A first-person shooter that used its own mechanics to critique the player. Rapture endures.' },
  { rank:18, title:'Undertale',                                year:2015, genre:'RPG',              description:'A subversive RPG that made kindness a mechanic and deconstructed every expectation.' },
  { rank:19, title:'Celeste',                                  year:2018, genre:'Platformer',       description:'Precision platforming as metaphor — a mountain climb that is really about anxiety and growth.' },
  { rank:20, title:'The Last of Us',                           year:2013, genre:'Action-Adventure', description:'Post-apocalyptic survival elevated into a devastating study of love and moral compromise.' },
  { rank:21, title:'Metal Gear Solid V: The Phantom Pain',     year:2015, genre:'Stealth',          description:'Unrivalled tactical freedom in an open world — Kojima\'s most mechanically ambitious work.' },
  { rank:22, title:'Stardew Valley',                           year:2016, genre:'Simulation RPG',   description:'One developer\'s love letter to farming and community — and somehow a cultural phenomenon.' },
  { rank:23, title:'Death Stranding',                          year:2019, genre:'Action',           description:'A game about connection disguised as a delivery sim. Polarising, strange, and unforgettable.' },
  { rank:24, title:'Minecraft',                                year:2011, genre:'Sandbox',          description:'The infinite creative space that redefined what a game could be. The best-selling title ever.' },
  { rank:25, title:'Deus Ex',                                  year:2000, genre:'RPG',              description:'The blueprint for immersive sims — player freedom, systemic depth, and genuine philosophy.' },
];
const FILMS = [
  { rank:1,  title:'2001: A Space Odyssey',                   year:1968, genre:'Sci-Fi',          description:'Kubrick\'s transcendent vision of evolution and the infinite. Cinema as pure experience.' },
  { rank:2,  title:'Apocalypse Now',                          year:1979, genre:'War Drama',        description:'Coppola\'s hallucinatory journey up the river — a war film that became a heart of darkness.' },
  { rank:3,  title:'The Godfather',                           year:1972, genre:'Crime Drama',      description:'The definitive American epic. Power, family, corruption — filmmaking at its absolute ceiling.' },
  { rank:4,  title:'Blade Runner 2049',                       year:2017, genre:'Sci-Fi',           description:'Villeneuve\'s meditative sequel — a blockbuster that asks what it means to matter.' },
  { rank:5,  title:'Mulholland Drive',                        year:2001, genre:'Neo-Noir',         description:'Lynch\'s surrealist nightmare about dreams, failure, and Hollywood\'s consuming cruelty.' },
  { rank:6,  title:'There Will Be Blood',                     year:2007, genre:'Drama',            description:'Paul Thomas Anderson\'s portrait of greed — Day-Lewis in a performance beyond language.' },
  { rank:7,  title:'No Country for Old Men',                  year:2007, genre:'Thriller',         description:'The Coens\' terrifying meditation on evil, chance, and the world\'s refusal to make sense.' },
  { rank:8,  title:'Parasite',                                year:2019, genre:'Thriller',         description:'Bong Joon-ho\'s genre-defying masterpiece — a film about class that becomes something else.' },
  { rank:9,  title:'Spirited Away',                           year:2001, genre:'Animation',        description:'Miyazaki\'s richest world: a spirit bathhouse holding everything strange about existence.' },
  { rank:10, title:'Mad Max: Fury Road',                      year:2015, genre:'Action',           description:'George Miller\'s two-hour chase — the most purely cinematic action film ever made.' },
  { rank:11, title:'The Tree of Life',                        year:2011, genre:'Drama',            description:'Malick\'s poetic meditation on childhood, grace, and the universe\'s indifferent beauty.' },
  { rank:12, title:'Eternal Sunshine of the Spotless Mind',   year:2004, genre:'Sci-Fi Romance',   description:'Gondry and Kaufman\'s inventive exploration of memory, loss, and why we love again.' },
  { rank:13, title:'Drive',                                   year:2011, genre:'Crime Drama',      description:'Refn\'s neon-soaked neo-noir — style and violence in perfect, lethal tension.' },
  { rank:14, title:'Whiplash',                                year:2014, genre:'Drama',            description:'Chazelle\'s drum-tight study of obsession, mentorship, and the price of greatness.' },
  { rank:15, title:'Interstellar',                            year:2014, genre:'Sci-Fi',           description:'Nolan\'s grandest ambition: space, time, and love as the fifth dimension.' },
  { rank:16, title:'Her',                                     year:2013, genre:'Sci-Fi Drama',     description:'Spike Jonze\'s tender, melancholy film about intimacy, loneliness, and what love requires.' },
  { rank:17, title:'Arrival',                                 year:2016, genre:'Sci-Fi',           description:'A profound meditation on language, grief, and choosing to love knowing the cost.' },
  { rank:18, title:'Eyes Wide Shut',                          year:1999, genre:'Drama',            description:'Kubrick\'s final film — a dreamlike odyssey through desire, paranoia, and marital mystery.' },
  { rank:19, title:'Under the Skin',                          year:2013, genre:'Sci-Fi',           description:'Glazer\'s alien gaze on humanity — abstract, sensory, and genuinely unsettling.' },
  { rank:20, title:'The Master',                              year:2012, genre:'Drama',            description:'PTA\'s complex study of faith, control, and two men locked in an impossible orbit.' },
  { rank:21, title:'Hereditary',                              year:2018, genre:'Horror',           description:'Ari Aster\'s devastating horror — grief as possession, family as inescapable fate.' },
  { rank:22, title:'Ex Machina',                              year:2014, genre:'Sci-Fi',           description:'Garland\'s claustrophobic thriller about consciousness, manipulation, and what we deserve.' },
  { rank:23, title:'Annihilation',                            year:2018, genre:'Sci-Fi Horror',    description:'Garland\'s hypnotic second film — transformation, self-destruction, the uncanny made beautiful.' },
  { rank:24, title:'Children of Men',                         year:2006, genre:'Sci-Fi Drama',     description:'Cuarón\'s gut-punch vision of a world without future — and the fragile hope that remains.' },
  { rank:25, title:'A Ghost Story',                           year:2017, genre:'Drama',            description:'Lowery\'s quiet, devastating meditation on time, grief, and what we leave behind.' },
];

function seed() {
  if (db.all('list_items').length > 0) return;

  let admin = db.findOne('users', u => u.is_admin);
  if (!admin) {
    admin = db.insert('users', {
      username:'admin', email:'admin@thequarter.com',
      password_hash: bcrypt.hashSync('Admin@TheQuarter1', 10), is_admin:true, google_id:null,
    });
    console.log('✓ Admin  →  admin@thequarter.com / Admin@TheQuarter1');
  }

  const gList = db.insert('lists', { title:"The Quarter's 25", category:'games', author_name:'The Quarter', description:'Twenty-five games that pushed the boundaries of what interactive art can be.', is_active:true, created_by:admin.id });
  const fList = db.insert('lists', { title:"The Quarter's 25", category:'films', author_name:'The Quarter', description:'Twenty-five films that captured something essential about the human experience.', is_active:true, created_by:admin.id });

  GAMES.forEach(g => db.insert('list_items', { ...g, list_id:gList.id, category:'games', is_revealed: g.rank<=10 }));
  FILMS.forEach(f => db.insert('list_items', { ...f, list_id:fList.id, category:'films', is_revealed: f.rank<=10 }));
  console.log('✓ Lists seeded (1–10 visible, 11–25 hidden)');

  const p1 = db.insert('polls', { title:'Best game of the 2010s', category:'games', created_by:admin.id, is_active:true });
  ['The Witcher 3: Wild Hunt|2015','Red Dead Redemption 2|2018','God of War|2018','Dark Souls III|2016','Hollow Knight|2017']
    .forEach(s => { const [t,y]=s.split('|'); db.insert('poll_options',{poll_id:p1.id,title:t,year:+y,vote_count:0}); });

  const p2 = db.insert('polls', { title:'Greatest sci-fi film of the 21st century', category:'films', created_by:admin.id, is_active:true });
  ['Blade Runner 2049|2017','Arrival|2016','Interstellar|2014','Her|2013','Ex Machina|2014']
    .forEach(s => { const [t,y]=s.split('|'); db.insert('poll_options',{poll_id:p2.id,title:t,year:+y,vote_count:0}); });
  console.log('✓ Polls seeded');
}
seed();

// ── Middleware ────────────────────────────────────────────────────────────────
const parseToken = (req,res,next) => {
  const t = (req.headers['authorization']||'').split(' ')[1];
  if (!t) { req.user=null; return next(); }
  jwt.verify(t, JWT_SECRET, (e,u) => { req.user = e ? null : u; next(); });
};
const requireAuth  = (req,res,next) => req.user ? next() : res.status(401).json({error:'Auth required'});
const requireAdmin = (req,res,next) => req.user?.is_admin ? next() : res.status(403).json({error:'Admin only'});

// ── Password validation ───────────────────────────────────────────────────────
function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters';
  const types = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (types < 3) return 'Password must include at least 3 of: uppercase, lowercase, numbers, special characters (!@#$… etc.)';
  return null;
}

// ── Config ────────────────────────────────────────────────────────────────────
app.get('/api/config', (_,res) => res.json({ googleClientId: GOOGLE_CLIENT_ID }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req,res) => {
  const { username, email, password } = req.body;
  if (!username||!email||!password) return res.status(400).json({error:'All fields required'});
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({error:pwErr});
  if (db.findOne('users', u=>u.email===email))    return res.status(400).json({error:'Email already registered'});
  if (db.findOne('users', u=>u.username===username)) return res.status(400).json({error:'Username taken'});
  const user = db.insert('users',{username,email,password_hash:bcrypt.hashSync(password,10),is_admin:false,google_id:null,first_name:'',last_name:'',bio:'',is_public:true});
  const ud = {id:user.id,username,email,is_admin:false,has_password:true};
  res.json({token:jwt.sign(ud,JWT_SECRET,{expiresIn:'7d'}),user:ud});
});

app.post('/api/auth/login', (req,res) => {
  const {email,password} = req.body;
  const user = db.findOne('users', u=>u.email===email);
  if (!user||!user.password_hash||!bcrypt.compareSync(password,user.password_hash))
    return res.status(401).json({error:'Invalid email or password'});
  const ud = {id:user.id,username:user.username,email:user.email,is_admin:user.is_admin,has_password:!!user.password_hash};
  res.json({token:jwt.sign(ud,JWT_SECRET,{expiresIn:'7d'}),user:ud});
});

app.post('/api/auth/change-password', parseToken, requireAuth, (req,res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.findOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({error:'User not found'});
  if (user.password_hash) {
    if (!currentPassword) return res.status(400).json({error:'Current password is required'});
    if (!bcrypt.compareSync(currentPassword, user.password_hash))
      return res.status(401).json({error:'Current password is incorrect'});
  }
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({error:pwErr});
  db.update('users', u => u.id === user.id, {password_hash: bcrypt.hashSync(newPassword, 10)});
  res.json({message:'Password updated successfully'});
});

app.post('/api/auth/google', async (req,res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({error:'Google Sign-In not configured'});
  const {credential} = req.body;
  if (!credential) return res.status(400).json({error:'No credential'});
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const p = await r.json();
    if (!r.ok || ![].concat(p.aud).map(s=>s.trim()).includes(GOOGLE_CLIENT_ID))
      return res.status(401).json({error:'Invalid Google token'});
    const {sub:googleId, email, name} = p;
    let user = db.findOne('users',u=>u.google_id===googleId) || db.findOne('users',u=>u.email===email);
    if (!user) {
      let base = (name||email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g,'_').slice(0,20);
      let uname=base, n=1;
      while (db.findOne('users',u=>u.username===uname)) uname=`${base}${n++}`;
      user = db.insert('users',{username:uname,email,google_id:googleId,password_hash:null,is_admin:false,first_name:'',last_name:'',bio:'',is_public:true});
    } else if (!user.google_id) {
      db.update('users',u=>u.id===user.id,{google_id:googleId});
    }
    const fresh = db.findOne('users', u => u.id === user.id);
    const ud = {id:fresh.id,username:fresh.username,email:fresh.email,is_admin:fresh.is_admin,has_password:!!fresh.password_hash};
    res.json({token:jwt.sign(ud,JWT_SECRET,{expiresIn:'7d'}),user:ud});
  } catch(e) { console.error(e); res.status(500).json({error:'Google auth failed'}); }
});

// ── Lists ─────────────────────────────────────────────────────────────────────
app.get('/api/categories/:cat/lists', (req,res) => {
  const lists = db.find('lists', l=>l.category===req.params.cat && l.is_active).sort((a,b)=>a.id-b.id);
  res.json(lists.map(l => {
    const items = db.find('list_items', i=>i.list_id===l.id);
    return { ...l, total_count:items.length, revealed_count:items.filter(i=>i.is_revealed).length };
  }));
});

app.get('/api/lists/:id', parseToken, (req,res) => {
  const list = db.findOne('lists', l=>l.id===+req.params.id && l.is_active);
  if (!list) return res.status(404).json({error:'List not found'});
  const isAdmin = !!req.user?.is_admin;
  const items = db.find('list_items', i=>i.list_id===list.id).sort((a,b)=>a.rank-b.rank)
    .map(item => (isAdmin||item.is_revealed) ? item : {id:item.id,list_id:item.list_id,rank:item.rank,is_revealed:false});
  res.json({...list, items});
});

app.post('/api/lists', parseToken, requireAdmin, (req,res) => {
  const {title,category,author_name,description} = req.body;
  if (!title||!category||!author_name) return res.status(400).json({error:'Title, category, author required'});
  res.json(db.insert('lists',{title,category,author_name,description:description||'',is_active:true,created_by:req.user.id}));
});

app.delete('/api/lists/:id', parseToken, requireAdmin, (req,res) => {
  db.update('lists', l=>l.id===+req.params.id, {is_active:false});
  res.json({message:'List deleted'});
});

app.patch('/api/lists/:id/feature', parseToken, requireAdmin, (req,res) => {
  const list = db.findOne('lists', l=>l.id===+req.params.id && l.is_active);
  if (!list) return res.status(404).json({error:'List not found'});
  // unfeature all others in same category first
  db.update('lists', l=>l.category===list.category && l.id!==list.id, {is_featured:false});
  db.update('lists', l=>l.id===list.id, {is_featured:true});
  res.json({message:'Featured'});
});

app.patch('/api/lists/:id/unfeature', parseToken, requireAdmin, (req,res) => {
  if (!db.findOne('lists', l=>l.id===+req.params.id)) return res.status(404).json({error:'Not found'});
  db.update('lists', l=>l.id===+req.params.id, {is_featured:false});
  res.json({message:'Unfeatured'});
});

// ── List items ────────────────────────────────────────────────────────────────
app.post('/api/lists/:id/items', parseToken, requireAuth, (req,res) => {
  const listId = +req.params.id;
  const list = db.findOne('lists', l=>l.id===listId&&l.is_active);
  if (!list) return res.status(404).json({error:'List not found'});
  const isOwner = list.created_by === req.user.id;
  if (!isOwner && !req.user.is_admin) return res.status(403).json({error:'Not authorized'});
  const {rank,title,year,genre,description,type,is_revealed=false} = req.body;
  if (!rank||!title) return res.status(400).json({error:'Rank and title required'});
  if (db.findOne('list_items', i=>i.list_id===listId&&i.rank===+rank))
    return res.status(400).json({error:`Rank ${rank} already used`});
  const autoReveal = list.category === 'personal' ? true : !!is_revealed;
  res.json(db.insert('list_items',{list_id:listId,category:list.category,rank:+rank,title,year:year?+year:null,genre:genre||'',description:description||'',type:type||null,is_revealed:autoReveal}));
});

app.patch('/api/items/:id/reveal', parseToken, requireAdmin, (req,res) => {
  if (!db.findOne('list_items',i=>i.id===+req.params.id)) return res.status(404).json({error:'Not found'});
  db.update('list_items',i=>i.id===+req.params.id,{is_revealed:true});
  res.json({message:'Revealed'});
});
app.patch('/api/items/:id/hide', parseToken, requireAdmin, (req,res) => {
  if (!db.findOne('list_items',i=>i.id===+req.params.id)) return res.status(404).json({error:'Not found'});
  db.update('list_items',i=>i.id===+req.params.id,{is_revealed:false});
  res.json({message:'Hidden'});
});
app.delete('/api/items/:id', parseToken, requireAuth, (req,res) => {
  const item = db.findOne('list_items', i=>i.id===+req.params.id);
  if (!item) return res.status(404).json({error:'Not found'});
  const list = db.findOne('lists', l=>l.id===item.list_id);
  if (!req.user.is_admin && list?.created_by !== req.user.id)
    return res.status(403).json({error:'Not authorized'});
  db.remove('list_items', i=>i.id===+req.params.id);
  res.json({message:'Deleted'});
});

// ── Polls ─────────────────────────────────────────────────────────────────────
app.get('/api/polls', parseToken, (req,res) => {
  const polls = db.find('polls',p=>p.is_active).sort((a,b)=>b.id-a.id);
  res.json(polls.map(poll => {
    const opts = db.find('poll_options',o=>o.poll_id===poll.id).sort((a,b)=>b.vote_count-a.vote_count);
    const total = opts.reduce((s,o)=>s+(o.vote_count||0),0);
    const v = req.user ? db.findOne('user_votes',v=>v.user_id===req.user.id&&v.poll_id===poll.id) : null;
    return {...poll, options:opts, totalVotes:total, userVote: v?.option_id||null};
  }));
});
app.post('/api/polls', parseToken, requireAdmin, (req,res) => {
  const {title,category,options} = req.body;
  if (!title||!category||!options||options.length<2) return res.status(400).json({error:'Title, category, 2+ options required'});
  const poll = db.insert('polls',{title,category,created_by:req.user.id,is_active:true});
  options.forEach(o=>db.insert('poll_options',{poll_id:poll.id,title:o.title,year:o.year||null,vote_count:0}));
  res.json({id:poll.id});
});
app.post('/api/polls/:id/vote', parseToken, requireAuth, (req,res) => {
  const pollId=+req.params.id, optId=+req.body.option_id;
  const poll = db.findOne('polls',p=>p.id===pollId&&p.is_active);
  if (!poll) return res.status(404).json({error:'Poll not found'});
  const opt = db.findOne('poll_options',o=>o.id===optId&&o.poll_id===pollId);
  if (!opt) return res.status(400).json({error:'Invalid option'});
  const existing = db.findOne('user_votes',v=>v.user_id===req.user.id&&v.poll_id===pollId);
  if (existing) {
    const old = db.findOne('poll_options',o=>o.id===existing.option_id);
    if (old) db.update('poll_options',o=>o.id===old.id,{vote_count:Math.max(0,(old.vote_count||1)-1)});
    db.update('user_votes',v=>v.user_id===req.user.id&&v.poll_id===pollId,{option_id:optId});
  } else {
    db.insert('user_votes',{user_id:req.user.id,poll_id:pollId,option_id:optId});
  }
  db.update('poll_options',o=>o.id===optId,{vote_count:(opt.vote_count||0)+1});
  const opts = db.find('poll_options',o=>o.poll_id===pollId).sort((a,b)=>b.vote_count-a.vote_count);
  res.json({...poll, options:opts, totalVotes:opts.reduce((s,o)=>s+(o.vote_count||0),0), userVote:optId});
});
app.delete('/api/polls/:id', parseToken, requireAdmin, (req,res) => {
  db.update('polls',p=>p.id===+req.params.id,{is_active:false});
  res.json({message:'Poll closed'});
});

// ── Profile (own) ─────────────────────────────────────────────────────────────
app.get('/api/auth/profile', parseToken, requireAuth, (req,res) => {
  const user = db.findOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({error:'User not found'});
  const { password_hash, google_id, ...safe } = user;
  res.json({ ...safe, has_password: !!user.password_hash, has_google: !!user.google_id });
});

app.patch('/api/auth/profile', parseToken, requireAuth, (req,res) => {
  const { first_name, last_name, bio, is_public } = req.body;
  const changes = {};
  if (first_name !== undefined) changes.first_name = String(first_name).slice(0,50);
  if (last_name  !== undefined) changes.last_name  = String(last_name).slice(0,50);
  if (bio        !== undefined) changes.bio        = String(bio).slice(0,300);
  if (is_public  !== undefined) changes.is_public  = !!is_public;
  db.update('users', u => u.id === req.user.id, changes);
  res.json({message:'Profile updated'});
});

app.get('/api/auth/my-list', parseToken, requireAuth, (req,res) => {
  let list = db.findOne('lists', l => l.category === 'personal' && l.created_by === req.user.id && l.is_active);
  if (!list) {
    const user = db.findOne('users', u => u.id === req.user.id);
    list = db.insert('lists', {
      title: `${user.username}'s Quarter`,
      category: 'personal',
      author_name: user.username,
      description: '',
      is_active: true,
      created_by: req.user.id,
    });
  }
  const items = db.find('list_items', i => i.list_id === list.id).sort((a,b) => a.rank - b.rank);
  res.json({ ...list, items });
});

// ── Users (search MUST be before :username) ───────────────────────────────────
app.get('/api/users/search', parseToken, (req,res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const users = db.find('users', u =>
    u.is_public &&
    (u.username.toLowerCase().includes(q) ||
     (u.first_name||'').toLowerCase().includes(q) ||
     (u.last_name||'').toLowerCase().includes(q))
  ).slice(0, 20);
  res.json(users.map(u => ({
    id: u.id, username: u.username,
    first_name: u.first_name || '', last_name: u.last_name || '',
    bio: u.bio || '', is_public: u.is_public,
  })));
});

app.get('/api/users/:username', parseToken, (req,res) => {
  const user = db.findOne('users', u => u.username === req.params.username);
  if (!user) return res.status(404).json({error:'User not found'});
  const isSelf = req.user?.id === user.id;
  if (!isSelf && !user.is_public) return res.status(403).json({error:'This profile is private'});
  const profile = {
    id: user.id, username: user.username,
    first_name: user.first_name || '', last_name: user.last_name || '',
    bio: user.bio || '', is_public: user.is_public, is_admin: user.is_admin,
    created_at: user.created_at,
  };
  const list = db.findOne('lists', l => l.category === 'personal' && l.created_by === user.id && l.is_active);
  const items = list ? db.find('list_items', i => i.list_id === list.id).sort((a,b) => a.rank - b.rank) : [];
  res.json({ ...profile, list: list ? { ...list, items } : null });
});

app.get('*', (_,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, () => console.log(`\n  THE QUARTER  →  http://localhost:${PORT}\n`));
