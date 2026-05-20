/* ── State ──────────────────────────────────────────────────────────────────── */
let currentUser = null;
let _toastTimer = null;

/* ── API helper ─────────────────────────────────────────────────────────────── */
const api = {
  _req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const token = localStorage.getItem('tq_token');
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || r.statusText);
      return data;
    });
  },
  get:    (p)    => api._req('GET',    p),
  post:   (p, b) => api._req('POST',   p, b),
  patch:  (p, b) => api._req('PATCH',  p, b),
  delete: (p)    => api._req('DELETE', p),
};

/* ── Toast ──────────────────────────────────────────────────────────────────── */
function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ── Escape ─────────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── Password validation & strength ─────────────────────────────────────────── */
function passwordScore(pw) {
  if (!pw) return 0;
  const long     = pw.length >= 8;
  const types    = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (types === 4 && long) return 4;
  if (types >= 3 && long)  return 3;   // meets minimum requirements
  if (types >= 2)          return 2;
  return 1;
}

const SCORE_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

function attachStrengthMeter(inputEl, wrapId, reqLengthId, reqTypesId) {
  const wrap    = document.getElementById(wrapId);
  if (!wrap) return;
  const bars    = wrap.querySelectorAll('.pw-bar');
  const label   = wrap.querySelector('.pw-label');
  const reqLen  = document.getElementById(reqLengthId);
  const reqType = document.getElementById(reqTypesId);

  inputEl.addEventListener('input', () => {
    const pw    = inputEl.value;
    const score = passwordScore(pw);
    const long  = pw.length >= 8;
    const types = pw ? [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length : 0;

    // Bars
    bars.forEach((b, i) => {
      b.className = 'pw-bar' + (i < score ? ` active-${score}` : '');
    });

    // Label
    label.textContent  = pw ? SCORE_LABELS[score] : '';
    label.className    = `pw-label${pw ? ` score-${score}` : ''}`;

    // Requirements checklist
    if (reqLen)  reqLen.classList.toggle('met',  long);
    if (reqType) reqType.classList.toggle('met', types >= 3);
  });
}

/* ── Auth ───────────────────────────────────────────────────────────────────── */
function initAuth() {
  const token = localStorage.getItem('tq_token');
  if (!token) { currentUser = null; return; }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('tq_token');
      currentUser = null;
      return;
    }
    currentUser = payload;
  } catch {
    localStorage.removeItem('tq_token');
    currentUser = null;
  }
}

function renderAuthUI() {
  const authBtns    = document.getElementById('authButtons');
  const userMenu    = document.getElementById('userMenu');
  const profileLink = document.getElementById('profileLink');
  const adminBtn    = document.getElementById('adminBtn');

  if (currentUser) {
    authBtns.classList.add('hidden');
    userMenu.classList.remove('hidden');
    if (profileLink) {
      profileLink.textContent = currentUser.username || currentUser.email;
      profileLink.href = '/profile/' + (currentUser.username || '');
    }
    adminBtn.style.display = currentUser.is_admin ? 'inline-flex' : 'none';
  } else {
    authBtns.classList.remove('hidden');
    userMenu.classList.add('hidden');
  }
}

/* ── Google Sign-In ─────────────────────────────────────────────────────────── */
function initGoogleSignIn(clientId) {
  if (!clientId) return;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
    });
    ['Login','Register'].forEach(suffix => {
      const wrap = document.getElementById('googleWrap' + suffix);
      const btn  = document.getElementById('googleBtn'  + suffix);
      if (wrap && btn) {
        wrap.classList.remove('hidden');
        window.google.accounts.id.renderButton(btn, {
          theme: 'filled_black', size: 'large', width: 388,
        });
      }
    });
  };
  document.head.appendChild(script);
}

async function handleGoogleCredential(response) {
  try {
    const data = await api.post('/api/auth/google', { credential: response.credential });
    localStorage.setItem('tq_token', data.token);
    initAuth();
    renderAuthUI();
    closeAllModals();
    showToast('Welcome, ' + (currentUser.username || currentUser.email) + '!');
  } catch (e) {
    showToast(e.message || 'Google sign-in failed');
  }
}

/* ── Modals ─────────────────────────────────────────────────────────────────── */
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
}

/* ── Router ─────────────────────────────────────────────────────────────────── */
function navigate(path, push = true) {
  if (push) history.pushState(null, '', path);
  route(path);
  updateNavActive(path);
}

function updateNavActive(path) {
  document.querySelectorAll('.nav-link[data-link]').forEach(a => {
    const href = a.getAttribute('href');
    const active =
      href === '/' ? path === '/'
      : path === href || path.startsWith(href + '/');
    a.classList.toggle('nav-active', active);
  });
}

function route(path) {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Loading…</div>';

  if (path === '/') return renderHome();
  if (path === '/games') return renderCategory('games');
  if (path === '/films') return renderCategory('films');
  if (path === '/community') return renderCommunity();
  if (path === '/people') return renderPeople();

  const listMatch    = path.match(/^\/list\/(\w+)$/);
  if (listMatch) return renderListPage(listMatch[1]);

  const profileMatch = path.match(/^\/profile\/([^/]+)$/);
  if (profileMatch) return renderProfile(decodeURIComponent(profileMatch[1]));

  renderNotFound();
}

/* intercept all data-link anchors */
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href !== location.pathname) navigate(href);
});

window.addEventListener('popstate', () => route(location.pathname));

/* ── Render: Home ───────────────────────────────────────────────────────────── */
async function renderHome() {
  const app = document.getElementById('app');

  let gamesLists = [], filmsLists = [];
  try {
    [gamesLists, filmsLists] = await Promise.all([
      api.get('/api/categories/games/lists'),
      api.get('/api/categories/films/lists'),
    ]);
  } catch { /* show empty */ }

  const gameChips = gamesLists.slice(0, 3)
    .map(l => `<span class="cat-chip">${esc(l.title)}</span>`).join('');
  const filmChips = filmsLists.slice(0, 3)
    .map(l => `<span class="cat-chip">${esc(l.title)}</span>`).join('');

  app.innerHTML = `
    <section class="hero" id="top">
      <div class="container">
        <p class="hero-eyebrow">THE DEFINITIVE LISTS</p>
        <h1 class="hero-title">The 25 That<br>Define the Art</h1>
        <p class="hero-subtitle">
          Curated rankings of the finest games and films ever made.<br>
          Vote, debate, and discover your own Quarter.
        </p>
        <div class="hero-ctas">
          <a href="/games" class="btn btn-games btn-lg" data-link>Explore Games</a>
          <a href="/films" class="btn btn-films btn-lg" data-link>Explore Films</a>
        </div>
        <div class="hero-stats">
          <div class="hero-stat games-stat">
            <span class="stat-n">25</span>
            <span class="stat-l">Essential Games</span>
          </div>
          <div class="hero-divider"></div>
          <div class="hero-stat films-stat">
            <span class="stat-n">25</span>
            <span class="stat-l">Essential Films</span>
          </div>
        </div>
        <div class="home-cats">
          <a href="/games" class="home-cat-card games-cat-card" data-link>
            <span class="cat-card-badge">Videogames</span>
            <p class="cat-card-title">The Quarter: Games</p>
            <p class="cat-card-sub">Twenty-five games that pushed the boundaries of what interactive art can be.</p>
            <div class="cat-chips">${gameChips || '<span class="cat-chip">No lists yet</span>'}</div>
          </a>
          <a href="/films" class="home-cat-card films-cat-card" data-link>
            <span class="cat-card-badge">Cinema</span>
            <p class="cat-card-title">The Quarter: Films</p>
            <p class="cat-card-sub">Twenty-five films that captured something essential about the human experience.</p>
            <div class="cat-chips">${filmChips || '<span class="cat-chip">No lists yet</span>'}</div>
          </a>
        </div>
      </div>
    </section>`;
}

/* ── Render: Category ───────────────────────────────────────────────────────── */
async function renderCategory(cat) {
  const app = document.getElementById('app');
  const isGames = cat === 'games';
  const heroClass = isGames ? 'games-hero' : 'films-hero';
  const badge = isGames ? 'VIDEOGAMES' : 'CINEMA';
  const catClass = isGames ? 'games' : 'films';
  const title = isGames ? 'The Quarter: Games' : 'The Quarter: Films';
  const sub = isGames
    ? 'Twenty-five games that pushed the boundaries of interactive art.'
    : 'Twenty-five films that captured something essential about the human experience.';

  let lists = [];
  try { lists = await api.get('/api/categories/' + cat + '/lists'); } catch { /* empty */ }

  const featured = lists.find(l => l.is_featured);
  const others   = lists.filter(l => !l.is_featured);

  // Fetch featured list's items if there is one
  let featuredList = null;
  if (featured) {
    try { featuredList = await api.get('/api/lists/' + featured.id); } catch { /* ignore */ }
  }

  // Featured items section
  let featuredHTML = '';
  if (featuredList) {
    const items = (featuredList.items || []).sort((a, b) => a.rank - b.rank);
    const itemsHTML = items.map(it => renderItem(it)).join('');
    featuredHTML = `
      <div class="featured-list-section">
        <div class="featured-list-header">
          <div>
            <span class="featured-badge">★ FEATURED</span>
            <h2 class="featured-list-title">${esc(featuredList.title)}</h2>
            ${featuredList.author_name ? `<p class="featured-list-author">Curated by ${esc(featuredList.author_name)}</p>` : ''}
          </div>
          <a href="/list/${esc(featuredList.id)}" class="btn btn-outline btn-sm" data-link>View full list →</a>
        </div>
        <div class="list-wrap ${catClass}-list-page">${itemsHTML || '<p class="muted-text">No items yet.</p>'}</div>
      </div>`;
  }

  // Other lists card grid
  const otherCards = others.map(l => `
    <a href="/list/${esc(l.id)}" class="list-card ${catClass}-list-card" data-link>
      <p class="list-card-eyebrow">THE QUARTER • ${badge}</p>
      <p class="list-card-title">${esc(l.title)}</p>
      ${l.author_name ? `<p class="list-card-author">By ${esc(l.author_name)}</p>` : ''}
      ${l.description ? `<p class="list-card-desc">${esc(l.description)}</p>` : ''}
    </a>`).join('');

  // If no featured, show all lists as cards
  const allCards = lists.map(l => `
    <a href="/list/${esc(l.id)}" class="list-card ${catClass}-list-card" data-link>
      <p class="list-card-eyebrow">THE QUARTER • ${badge}</p>
      <p class="list-card-title">${esc(l.title)}</p>
      ${l.author_name ? `<p class="list-card-author">By ${esc(l.author_name)}</p>` : ''}
      ${l.description ? `<p class="list-card-desc">${esc(l.description)}</p>` : ''}
    </a>`).join('');

  let bodyHTML;
  if (!lists.length) {
    bodyHTML = '<p class="muted-text">No lists yet.</p>';
  } else if (featuredHTML) {
    bodyHTML = featuredHTML + (others.length ? `
      <div class="other-lists-section">
        <p class="other-lists-label">MORE LISTS</p>
        <div class="list-cards-grid">${otherCards}</div>
      </div>` : '');
  } else {
    bodyHTML = `<div class="list-cards-grid">${allCards}</div>`;
  }

  app.innerHTML = `
    <section class="page-hero ${heroClass}">
      <div class="container">
        <a href="/" class="back-link" data-link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Home
        </a>
        <p class="page-hero-eyebrow"><span class="section-badge ${isGames ? 'games' : 'films'}-badge">${badge}</span></p>
        <h1 class="page-hero-title">${title}</h1>
        <p class="page-hero-sub">${sub}</p>
      </div>
    </section>
    <div class="page-body">
      <div class="container">${bodyHTML}</div>
    </div>`;
}

/* ── Render: List page ──────────────────────────────────────────────────────── */
async function renderListPage(id) {
  const app = document.getElementById('app');

  let list;
  try { list = await api.get('/api/lists/' + id); }
  catch { return renderNotFound(); }

  const isGames = list.category === 'games';
  const heroClass = isGames ? 'games-hero' : 'films-hero';
  const badge = isGames ? 'VIDEOGAMES' : 'CINEMA';
  const pageClass = isGames ? 'games-list-page' : 'films-list-page';
  const backHref = '/' + list.category;

  const items = (list.items || []).sort((a, b) => a.rank - b.rank);
  const itemsHTML = items.map(it => renderItem(it)).join('');

  app.innerHTML = `
    <section class="page-hero ${heroClass}">
      <div class="container">
        <a href="${backHref}" class="back-link" data-link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          ${isGames ? 'Games' : 'Films'}
        </a>
        <p class="page-hero-eyebrow"><span class="section-badge ${isGames ? 'games' : 'films'}-badge">${badge}</span></p>
        <h1 class="page-hero-title">${esc(list.title)}</h1>
        ${list.description ? `<p class="page-hero-sub">${esc(list.description)}</p>` : ''}
        ${list.author_name ? `<p class="page-hero-author">Curated by ${esc(list.author_name)}</p>` : ''}
      </div>
    </section>
    <div class="page-body">
      <div class="container">
        <div class="list-wrap ${pageClass}">${itemsHTML || '<p class="muted-text">No items yet.</p>'}</div>
      </div>
    </div>`;
}

/* ── Render: single list item ───────────────────────────────────────────────── */
function renderItem(item) {
  if (!item.is_revealed) {
    return `
      <div class="list-item is-unrevealed">
        <div class="list-rank">${item.rank}</div>
        <div class="list-info">
          <div class="unrevealed-row">
            <span class="unrevealed-lock">🔒</span>
            <span class="unrevealed-label">Coming Soon</span>
          </div>
          <div class="unrevealed-lines">
            <div class="unrev-line" style="width:68%"></div>
            <div class="unrev-line" style="width:44%"></div>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="list-item">
      <div class="list-rank">${item.rank}</div>
      <div class="list-info">
        <p class="list-title">${esc(item.title)}</p>
        <div class="list-meta">
          ${item.genre ? `<span class="list-genre">${esc(item.genre)}</span>` : ''}
          ${item.year  ? `<span class="list-year">${esc(item.year)}</span>`   : ''}
        </div>
        ${item.description ? `<p class="list-desc">${esc(item.description)}</p>` : ''}
      </div>
    </div>`;
}

/* ── Render: Community ──────────────────────────────────────────────────────── */
async function renderCommunity() {
  const app = document.getElementById('app');

  let polls = [];
  try { polls = await api.get('/api/polls'); } catch { /* empty */ }

  app.innerHTML = `
    <section class="page-hero">
      <div class="container">
        <a href="/" class="back-link" data-link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Home
        </a>
        <p class="page-hero-eyebrow"><span class="section-badge">COMMUNITY</span></p>
        <h1 class="page-hero-title">The People's Quarter</h1>
        <p class="page-hero-sub">Vote on what belongs in the definitive lists. Your opinion shapes the canon.</p>
      </div>
    </section>
    <div class="page-body">
      <div class="container">
        <div id="pollsContainer">${renderPollsHTML(polls)}</div>
        ${!currentUser ? `
          <div class="login-prompt" style="margin-top:24px">
            <p>Sign in to cast your votes and help shape The Quarter.</p>
            <button class="btn btn-primary" onclick="openModal('loginModal')">Sign In to Vote</button>
          </div>` : ''}
      </div>
    </div>`;
}

function renderPollsHTML(polls) {
  if (!polls.length) return '<p class="no-polls">No active polls yet. Check back soon.</p>';
  return `<div class="polls-grid">${polls.map(p => renderPollCard(p)).join('')}</div>`;
}

function renderPollCard(poll) {
  const totalVotes = poll.options.reduce((s, o) => s + (o.vote_count || 0), 0);
  const cat = poll.category || 'games';
  const isGames = cat === 'games';

  const optionsHTML = poll.options.map(opt => {
    const pct = totalVotes ? Math.round((opt.vote_count || 0) / totalVotes * 100) : 0;
    const isMyVote = currentUser && poll.userVote === opt.id;

    if (!currentUser || !poll.userVote) {
      return `<button class="vote-btn" data-poll="${poll.id}" data-opt="${opt.id}">
        ${esc(opt.title)}${opt.year ? ' (' + opt.year + ')' : ''}
      </button>`;
    }
    return `
      <div class="bar-wrap ${isMyVote ? 'my-vote' : ''} ${isGames ? 'is-games' : 'is-films'}">
        <div class="bar-fill" style="width:${pct}%"></div>
        <div class="bar-text">
          <span class="bar-label">${esc(opt.title)}${opt.year ? ' (' + opt.year + ')' : ''}</span>
          <span>${isMyVote ? `<span class="bar-check">✓</span>` : ''} <span class="bar-pct">${pct}%</span></span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="poll-card" id="poll-${poll.id}">
      <div class="poll-card-head">
        <p class="poll-q">${esc(poll.title)}</p>
        <span class="poll-cat-badge ${isGames ? 'cat-games' : 'cat-films'}">${isGames ? 'Games' : 'Films'}</span>
      </div>
      <p class="poll-votes-count">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</p>
      <div class="poll-options">${optionsHTML}</div>
    </div>`;
}

document.addEventListener('click', async e => {
  const btn = e.target.closest('.vote-btn');
  if (!btn) return;
  await castVote(btn.dataset.poll, btn.dataset.opt);
});

async function castVote(pollId, optId) {
  if (!currentUser) { openModal('loginModal'); return; }
  try {
    const updated = await api.post(`/api/polls/${pollId}/vote`, { option_id: optId });
    const card = document.getElementById('poll-' + pollId);
    if (card) card.outerHTML = renderPollCard(updated);
  } catch (e) {
    showToast(e.message || 'Vote failed');
  }
}

/* ── Render: 404 ────────────────────────────────────────────────────────────── */
function renderNotFound() {
  document.getElementById('app').innerHTML = `
    <div class="not-found">
      <h2>404</h2>
      <p>This page doesn't exist.</p>
      <a href="/" class="btn btn-ghost" data-link style="margin-top:24px">← Back home</a>
    </div>`;
}

/* ── Render: Profile ────────────────────────────────────────────────────────── */
async function renderProfile(username) {
  const app = document.getElementById('app');
  const isSelf = !!(currentUser && currentUser.username === username);

  let profile;
  try {
    profile = await api.get('/api/users/' + encodeURIComponent(username));
  } catch(e) {
    if (e.message && e.message.toLowerCase().includes('private')) {
      app.innerHTML = `
        <div class="not-found">
          <h2>Private</h2>
          <p>This profile is private.</p>
          <a href="/people" class="btn btn-ghost" data-link style="margin-top:24px">← People</a>
        </div>`;
      return;
    }
    return renderNotFound();
  }

  const initials = (
    ((profile.first_name||'')[0] || (profile.username||'')[0] || '?').toUpperCase() +
    ((profile.last_name||'')[0] || '').toUpperCase()
  );
  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ');

  app.innerHTML = `
    <div class="profile-page">
      <div class="profile-header">
        <div class="profile-avatar">${esc(initials)}</div>
        <div class="profile-meta">
          <p class="profile-username">${esc(profile.username)}</p>
          ${fullName ? `<p class="profile-fullname">${esc(fullName)}</p>` : ''}
          ${profile.bio ? `<p class="profile-bio">${esc(profile.bio)}</p>` : ''}
          <div class="profile-badges">
            ${profile.is_admin ? `<span class="profile-badge admin">★ Admin</span>` : ''}
            ${!profile.is_public ? `<span class="profile-badge private">Private</span>` : ''}
          </div>
        </div>
      </div>

      ${isSelf ? `
      <div class="profile-section">
        <p class="profile-section-title">Profile Settings</p>
        <form id="profileSettingsForm">
          <div class="profile-name-row">
            <div class="field">
              <label for="profileFirstName">First Name</label>
              <input type="text" id="profileFirstName" value="${esc(profile.first_name||'')}" placeholder="First name" maxlength="50">
            </div>
            <div class="field">
              <label for="profileLastName">Last Name</label>
              <input type="text" id="profileLastName" value="${esc(profile.last_name||'')}" placeholder="Last name" maxlength="50">
            </div>
          </div>
          <div class="field">
            <label for="profileBio">Bio</label>
            <textarea id="profileBio" placeholder="Tell people about yourself…" maxlength="300" rows="3">${esc(profile.bio||'')}</textarea>
          </div>
          <div class="toggle-row">
            <div>
              <p class="toggle-label">Public Profile</p>
              <p class="toggle-sub">Other users can find and view your profile</p>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="profileIsPublic" ${profile.is_public ? 'checked' : ''}>
              <span class="toggle-track"></span>
            </label>
          </div>
          <p class="form-error hidden" id="profileSettingsError"></p>
          <button type="submit" class="btn btn-primary" style="margin-top:18px">Save Changes</button>
        </form>
      </div>
      ` : ''}

      <div class="profile-section">
        <p class="profile-section-title">${isSelf ? 'My Quarter' : esc(profile.username) + "'s Quarter"}</p>
        ${buildPersonalListHTML(profile.list, isSelf)}
        ${isSelf ? `
        <form id="addPersonalItemForm">
          <div class="add-personal-grid">
            <div class="field">
              <label>Rank</label>
              <input type="number" id="piRank" min="1" max="100" placeholder="#" required>
            </div>
            <div class="field type-field">
              <label>Type</label>
              <select id="piType">
                <option value="">Any</option>
                <option value="game">Game</option>
                <option value="film">Film</option>
              </select>
            </div>
            <div class="field">
              <label>Title</label>
              <input type="text" id="piTitle" placeholder="Title" required>
            </div>
            <div class="field year-field">
              <label>Year</label>
              <input type="number" id="piYear" placeholder="Year" min="1900" max="2030">
            </div>
            <div class="field" style="align-self:end">
              <button type="submit" class="btn btn-primary full-w" style="margin-bottom:0">Add</button>
            </div>
          </div>
          <div class="field" style="margin-top:8px">
            <input type="text" id="piDesc" placeholder="Description (optional)" maxlength="200">
          </div>
          <p class="form-error hidden" id="addPersonalItemError"></p>
        </form>
        ` : ''}
      </div>

      ${isSelf ? `
      <div class="profile-section">
        <p class="profile-section-title">Change Password</p>
        ${!currentUser.has_password ? `<p class="field-hint" style="margin-bottom:16px">You signed in with Google — leave Current Password blank to set a password for the first time.</p>` : ''}
        <form id="profileChangePwForm" class="change-pw-form" novalidate>
          ${currentUser.has_password ? `
          <div class="field">
            <label for="profCurrentPw">Current Password</label>
            <input type="password" id="profCurrentPw" placeholder="Your current password" autocomplete="current-password">
          </div>` : ''}
          <div class="field">
            <label for="profNewPw">New Password</label>
            <input type="password" id="profNewPw" placeholder="Min. 8 characters" autocomplete="new-password" required>
            <div class="pw-strength-wrap" id="profPwStrength">
              <div class="pw-bars">
                <div class="pw-bar"></div><div class="pw-bar"></div>
                <div class="pw-bar"></div><div class="pw-bar"></div>
              </div>
              <span class="pw-label"></span>
            </div>
            <ul class="pw-requirements">
              <li class="pw-req" id="profReqLength">8+ characters</li>
              <li class="pw-req" id="profReqTypes">3 character types (A-Z, a-z, 0-9, symbols)</li>
            </ul>
          </div>
          <div class="field">
            <label for="profConfirmPw">Confirm New Password</label>
            <input type="password" id="profConfirmPw" placeholder="Repeat new password" autocomplete="new-password" required>
          </div>
          <p class="form-error hidden" id="profChangePwError"></p>
          <button type="submit" class="btn btn-primary">Update Password</button>
        </form>
      </div>
      ` : ''}
    </div>`;

  if (!isSelf) return;

  /* ── own-profile event listeners ─────────────────────────────────────── */
  document.getElementById('profileSettingsForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('profileSettingsError');
    errEl.classList.add('hidden');
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api.patch('/api/auth/profile', {
        first_name: document.getElementById('profileFirstName').value.trim(),
        last_name:  document.getElementById('profileLastName').value.trim(),
        bio:        document.getElementById('profileBio').value.trim(),
        is_public:  document.getElementById('profileIsPublic').checked,
      });
      showToast('Profile updated');
    } catch(err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });

  document.getElementById('addPersonalItemForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('addPersonalItemError');
    errEl.classList.add('hidden');
    try {
      const myList = await api.get('/api/auth/my-list');
      await api.post('/api/lists/' + myList.id + '/items', {
        rank:        parseInt(document.getElementById('piRank').value),
        title:       document.getElementById('piTitle').value.trim(),
        year:        document.getElementById('piYear').value || null,
        type:        document.getElementById('piType').value || null,
        description: document.getElementById('piDesc').value.trim() || null,
      });
      showToast('Added to your Quarter');
      renderProfile(username);
    } catch(err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  attachStrengthMeter(
    document.getElementById('profNewPw'),
    'profPwStrength', 'profReqLength', 'profReqTypes'
  );
  document.getElementById('profileChangePwForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('profChangePwError');
    errEl.classList.add('hidden');
    const currentPw = document.getElementById('profCurrentPw')?.value || '';
    const newPw     = document.getElementById('profNewPw').value;
    const confirmPw = document.getElementById('profConfirmPw').value;
    if (newPw !== confirmPw) {
      errEl.textContent = 'Passwords do not match'; errEl.classList.remove('hidden'); return;
    }
    if (passwordScore(newPw) < 3) {
      errEl.textContent = 'Password too weak — use 8+ characters and at least 3 character types';
      errEl.classList.remove('hidden'); return;
    }
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Updating…';
    try {
      await api.post('/api/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      showToast('Password updated successfully');
      currentUser.has_password = true;
      e.target.reset();
    } catch(err) {
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Update Password';
    }
  });
}

function buildPersonalListHTML(list, isSelf) {
  if (!list || !list.items || !list.items.length) {
    return `<p class="personal-list-empty">No items yet.${isSelf ? ' Add your first pick below!' : ''}</p>`;
  }
  const rows = list.items.map(item => {
    const tc = item.type === 'game' ? 'game' : item.type === 'film' ? 'film' : 'none';
    const tl = item.type === 'game' ? 'GAME' : item.type === 'film' ? 'FILM' : '—';
    return `
      <div class="personal-item-row">
        <span class="personal-rank">${item.rank}</span>
        <span class="personal-type-badge ${tc}">${tl}</span>
        <div class="personal-item-info">
          <p class="personal-item-title">${esc(item.title)}</p>
          ${item.year ? `<span class="personal-item-year">${item.year}</span>` : ''}
          ${item.description ? `<p class="personal-item-desc">${esc(item.description)}</p>` : ''}
        </div>
        ${isSelf ? `<button class="btn btn-danger btn-sm" onclick="deletePersonalItem(${item.id})">×</button>` : ''}
      </div>`;
  }).join('');
  return `<div class="personal-list-section">${rows}</div>`;
}

async function deletePersonalItem(itemId) {
  if (!confirm('Remove this from your Quarter?')) return;
  try {
    await api.delete('/api/items/' + itemId);
    showToast('Removed');
    renderProfile(currentUser.username);
  } catch(e) { showToast(e.message); }
}

/* ── Render: People ─────────────────────────────────────────────────────────── */
async function renderPeople() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="people-page">
      <h1 style="font-family:'Playfair Display',serif;font-size:36px;font-weight:900;color:var(--t100);margin-bottom:8px">People</h1>
      <p style="color:var(--t600);margin-bottom:32px">Find other members of The Quarter</p>
      <div class="people-search-wrap">
        <span class="people-search-icon">⌕</span>
        <input type="text" class="people-search-input" id="peopleSearch" placeholder="Search by username or name…" autocomplete="off">
      </div>
      <div id="peopleResults" class="people-empty"><p>Start typing to find people.</p></div>
    </div>`;

  let timer;
  document.getElementById('peopleSearch')?.addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    const resultsEl = document.getElementById('peopleResults');
    if (!q) {
      resultsEl.className = 'people-empty';
      resultsEl.innerHTML = '<p>Start typing to find people.</p>';
      return;
    }
    timer = setTimeout(async () => {
      try {
        const users = await api.get('/api/users/search?q=' + encodeURIComponent(q));
        if (!users.length) {
          resultsEl.className = 'people-empty';
          resultsEl.innerHTML = '<p>No members found.</p>';
          return;
        }
        resultsEl.className = 'people-results';
        resultsEl.innerHTML = users.map(u => {
          const initials = (
            ((u.first_name||'')[0] || (u.username||'')[0] || '?').toUpperCase() +
            ((u.last_name||'')[0] || '').toUpperCase()
          );
          const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
          return `
            <a href="/profile/${esc(u.username)}" class="user-card" data-link>
              <div class="user-card-top">
                <div class="user-card-avatar">${esc(initials)}</div>
                <div>
                  <p class="user-card-username">${esc(u.username)}</p>
                  ${fullName ? `<p class="user-card-fullname">${esc(fullName)}</p>` : ''}
                </div>
              </div>
              ${u.bio ? `<p class="user-card-bio">${esc(u.bio)}</p>` : ''}
            </a>`;
        }).join('');
      } catch { /* ignore */ }
    }, 300);
  });
}

/* ── Admin modal ────────────────────────────────────────────────────────────── */
let _adminTab = 'lists';

function switchAdminTab(tab) {
  _adminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'lists') renderAdminLists();
  else renderAdminPolls();
}

/* ── Admin: Lists tab ───────────────────────────────────────────────────────── */
let _adminListView = 'index';

async function renderAdminLists() {
  if (_adminListView === 'index') return loadAdminListsIndex();
  return loadAdminListDetail(_adminListView);
}

async function loadAdminListsIndex() {
  const el = document.getElementById('adminTabContent');
  el.innerHTML = '<p class="muted-text">Loading…</p>';
  let gLists = [], fLists = [];
  try {
    [gLists, fLists] = await Promise.all([
      api.get('/api/categories/games/lists'),
      api.get('/api/categories/films/lists'),
    ]);
  } catch { /* empty */ }

  const rowsFor = (lists) => lists.map(l => `
    <div class="admin-list-row">
      <span class="admin-list-cat ${l.category === 'games' ? 'is-games' : 'is-films'}">${l.category}</span>
      <span>${esc(l.title)}${l.is_featured ? ' <span class="featured-dot">★</span>' : ''}</span>
      <button class="btn btn-ghost btn-sm" onclick="adminManageList('${l.id}')">Manage</button>
      ${l.is_featured
        ? `<button class="btn btn-outline btn-sm" onclick="adminUnfeatureList('${l.id}')">Unfeature</button>`
        : `<button class="btn btn-outline btn-sm" onclick="adminFeatureList('${l.id}')">Feature</button>`}
      <button class="btn btn-danger btn-sm" onclick="adminDeleteList('${l.id}')">Delete</button>
    </div>`).join('');

  el.innerHTML = `
    <h4 class="admin-subtitle">Create New List</h4>
    <form id="createListForm">
      <div class="field">
        <label for="newListTitle">Title</label>
        <input type="text" id="newListTitle" placeholder="The Quarter's 25" required>
      </div>
      <div class="field">
        <label for="newListCat">Category</label>
        <select id="newListCat">
          <option value="games">Games</option>
          <option value="films">Films</option>
        </select>
      </div>
      <div class="field">
        <label for="newListAuthor">Author (optional)</label>
        <input type="text" id="newListAuthor" placeholder="The Quarter">
      </div>
      <div class="field">
        <label for="newListDesc">Description (optional)</label>
        <input type="text" id="newListDesc" placeholder="Short description">
      </div>
      <p class="form-error hidden" id="createListError"></p>
      <button type="submit" class="btn btn-primary full-w">Create List</button>
    </form>
    <div class="admin-subsection">
      <h4 class="admin-subtitle">All Lists</h4>
      <p class="admin-section-label">Games</p>
      ${gLists.length ? rowsFor(gLists) : '<p class="muted-text">None</p>'}
      <p class="admin-section-label" style="margin-top:14px">Films</p>
      ${fLists.length ? rowsFor(fLists) : '<p class="muted-text">None</p>'}
    </div>`;

  document.getElementById('createListForm')?.addEventListener('submit', handleCreateList);
}

async function handleCreateList(e) {
  e.preventDefault();
  const errEl = document.getElementById('createListError');
  errEl.classList.add('hidden');
  const body = {
    title:       document.getElementById('newListTitle').value.trim(),
    category:    document.getElementById('newListCat').value,
    author_name: document.getElementById('newListAuthor').value.trim(),
    description: document.getElementById('newListDesc').value.trim(),
  };
  try {
    await api.post('/api/lists', body);
    showToast('List created');
    loadAdminListsIndex();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function adminDeleteList(id) {
  if (!confirm('Delete this list and all its items?')) return;
  try {
    await api.delete('/api/lists/' + id);
    showToast('List deleted');
    loadAdminListsIndex();
  } catch (e) { showToast(e.message); }
}

function adminManageList(id) {
  _adminListView = id;
  loadAdminListDetail(id);
}

async function loadAdminListDetail(id) {
  const el = document.getElementById('adminTabContent');
  el.innerHTML = '<p class="muted-text">Loading…</p>';
  let list;
  try { list = await api.get('/api/lists/' + id); }
  catch { el.innerHTML = '<p class="muted-text">Failed to load list.</p>'; return; }

  const items = (list.items || []).sort((a, b) => a.rank - b.rank);

  const itemRows = items.map(it => `
    <div class="item-manage-row">
      <span class="item-manage-rank">${it.rank}</span>
      <span class="item-manage-title">${esc(it.title)}</span>
      <span class="item-manage-year">${it.year || ''}</span>
      <span class="item-manage-status ${it.is_revealed ? 'status-revealed' : 'status-hidden'}">${it.is_revealed ? 'Visible' : 'Hidden'}</span>
      ${it.is_revealed
        ? `<button class="btn btn-ghost btn-sm" onclick="adminHideItem('${it.id}','${id}')">Hide</button>`
        : `<button class="btn btn-games btn-sm" onclick="adminRevealItem('${it.id}','${id}')">Reveal</button>`}
      <button class="btn btn-danger btn-sm" onclick="adminDeleteItem('${it.id}','${id}')">Del</button>
    </div>`).join('');

  el.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="adminBackToLists()" style="margin-bottom:16px">← All Lists</button>
    <h4 class="admin-subtitle">${esc(list.title)}</h4>
    <p class="muted-text" style="margin-bottom:20px">${list.category} · ${items.length} items</p>

    <h4 class="admin-subtitle">Add Item</h4>
    <form id="addItemForm">
      <div class="add-item-grid">
        <input type="number" id="newItemRank"  placeholder="#" min="1" max="25" required>
        <input type="text"   id="newItemTitle" placeholder="Title" required>
        <input type="number" id="newItemYear"  placeholder="Year" min="1900" max="2030">
      </div>
      <div class="field" style="margin-top:8px">
        <input type="text" id="newItemGenre" placeholder="Genre (optional)">
      </div>
      <div class="field">
        <input type="text" id="newItemDesc" placeholder="Description (optional)">
      </div>
      <p class="form-error hidden" id="addItemError"></p>
      <button type="submit" class="btn btn-primary full-w">Add Item</button>
    </form>

    <div class="admin-subsection">
      <h4 class="admin-subtitle">Items</h4>
      ${items.length ? itemRows : '<p class="muted-text">No items yet.</p>'}
    </div>`;

  document.getElementById('addItemForm')?.addEventListener('submit', e => handleAddItemSubmit(e, id));
}

function adminBackToLists() {
  _adminListView = 'index';
  loadAdminListsIndex();
}

async function handleAddItemSubmit(e, listId) {
  e.preventDefault();
  const errEl = document.getElementById('addItemError');
  errEl.classList.add('hidden');
  const body = {
    rank:        parseInt(document.getElementById('newItemRank').value),
    title:       document.getElementById('newItemTitle').value.trim(),
    year:        document.getElementById('newItemYear').value || null,
    genre:       document.getElementById('newItemGenre').value.trim() || null,
    description: document.getElementById('newItemDesc').value.trim() || null,
  };
  try {
    await api.post('/api/lists/' + listId + '/items', body);
    showToast('Item added');
    loadAdminListDetail(listId);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function _modalScrollTop() {
  return document.querySelector('#adminModal .modal')?.scrollTop ?? 0;
}
function _restoreModalScroll(y) {
  requestAnimationFrame(() => {
    const m = document.querySelector('#adminModal .modal');
    if (m) m.scrollTop = y;
  });
}

async function adminRevealItem(itemId, listId) {
  const y = _modalScrollTop();
  try {
    await api.patch('/api/items/' + itemId + '/reveal');
    showToast('Item revealed');
    await loadAdminListDetail(listId);
    _restoreModalScroll(y);
  } catch (e) { showToast(e.message); }
}

async function adminHideItem(itemId, listId) {
  const y = _modalScrollTop();
  try {
    await api.patch('/api/items/' + itemId + '/hide');
    showToast('Item hidden');
    await loadAdminListDetail(listId);
    _restoreModalScroll(y);
  } catch (e) { showToast(e.message); }
}

async function adminDeleteItem(itemId, listId) {
  if (!confirm('Delete this item?')) return;
  const y = _modalScrollTop();
  try {
    await api.delete('/api/items/' + itemId);
    showToast('Item deleted');
    await loadAdminListDetail(listId);
    _restoreModalScroll(y);
  } catch (e) { showToast(e.message); }
}

async function adminFeatureList(id) {
  try {
    await api.patch('/api/lists/' + id + '/feature');
    showToast('List featured — it will display inline on the category page');
    loadAdminListsIndex();
  } catch (e) { showToast(e.message); }
}

async function adminUnfeatureList(id) {
  try {
    await api.patch('/api/lists/' + id + '/unfeature');
    showToast('List unfeatured');
    loadAdminListsIndex();
  } catch (e) { showToast(e.message); }
}

/* ── Admin: Polls tab ───────────────────────────────────────────────────────── */
async function renderAdminPolls() {
  const el = document.getElementById('adminTabContent');
  el.innerHTML = '<p class="muted-text">Loading…</p>';
  let polls = [];
  try { polls = await api.get('/api/polls'); } catch { /* empty */ }

  const pollRows = polls.map(p => {
    const total = p.options.reduce((s, o) => s + (o.votes || 0), 0);
    return `
      <div class="admin-poll-row">
        <span>${esc(p.title)}</span>
        <span class="admin-poll-votes">${total} vote${total !== 1 ? 's' : ''}</span>
        <button class="btn btn-danger btn-sm" onclick="adminDeletePoll('${p.id}')">Delete</button>
      </div>`;
  }).join('');

  el.innerHTML = `
    <h4 class="admin-subtitle">Create New Poll</h4>
    <form id="pollForm">
      <div class="field">
        <label for="pollTitle">Poll Question</label>
        <input type="text" id="pollTitle" placeholder="What is the best game of the decade?" required>
      </div>
      <div class="field">
        <label for="pollCategory">Category</label>
        <select id="pollCategory">
          <option value="games">Games</option>
          <option value="films">Films</option>
        </select>
      </div>
      <div class="field">
        <label>Options</label>
        <div id="pollOptions">
          <div class="opt-row">
            <input type="text" placeholder="Option 1" class="opt-title">
            <input type="number" placeholder="Year" class="opt-year" min="1900" max="2030">
          </div>
          <div class="opt-row">
            <input type="text" placeholder="Option 2" class="opt-title">
            <input type="number" placeholder="Year" class="opt-year" min="1900" max="2030">
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="addOptBtn" style="margin-top:8px">+ Add option</button>
      </div>
      <p class="form-error hidden" id="pollError"></p>
      <button type="submit" class="btn btn-primary full-w">Publish Poll</button>
    </form>
    <div class="admin-polls-section">
      <h4 class="admin-subtitle">Active Polls</h4>
      ${polls.length ? pollRows : '<p class="muted-text">No polls yet.</p>'}
    </div>`;

  document.getElementById('pollForm')?.addEventListener('submit', handleCreatePoll);
  document.getElementById('addOptBtn')?.addEventListener('click', () => {
    const container = document.getElementById('pollOptions');
    const n = container.children.length + 1;
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.innerHTML = `
      <input type="text" placeholder="Option ${n}" class="opt-title">
      <input type="number" placeholder="Year" class="opt-year" min="1900" max="2030">`;
    container.appendChild(row);
  });
}

async function handleCreatePoll(e) {
  e.preventDefault();
  const errEl = document.getElementById('pollError');
  errEl.classList.add('hidden');
  const titles = [...document.querySelectorAll('.opt-title')].map(i => i.value.trim()).filter(Boolean);
  const years  = [...document.querySelectorAll('.opt-year')].map(i => i.value || null);
  if (titles.length < 2) {
    errEl.textContent = 'Add at least 2 options.';
    errEl.classList.remove('hidden');
    return;
  }
  const options = titles.map((t, i) => ({ title: t, year: years[i] }));
  try {
    await api.post('/api/polls', {
      title:    document.getElementById('pollTitle').value.trim(),
      category: document.getElementById('pollCategory').value,
      options,
    });
    showToast('Poll published');
    renderAdminPolls();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function adminDeletePoll(id) {
  if (!confirm('Delete this poll?')) return;
  try {
    await api.delete('/api/polls/' + id);
    showToast('Poll deleted');
    renderAdminPolls();
  } catch (e) { showToast(e.message); }
}

/* ── Boot ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  renderAuthUI();

  /* config (Google Sign-In) */
  try {
    const cfg = await api.get('/api/config');
    if (cfg.googleClientId) initGoogleSignIn(cfg.googleClientId);
  } catch { /* no config */ }

  /* modal close buttons */
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllModals(); });

  /* strength meter for register form */
  attachStrengthMeter(
    document.getElementById('regPassword'),
    'regPwStrength', 'regReqLength', 'regReqTypes'
  );

  document.getElementById('loginBtn')?.addEventListener('click',    () => openModal('loginModal'));
  document.getElementById('registerBtn')?.addEventListener('click', () => openModal('registerModal'));
  document.getElementById('adminBtn')?.addEventListener('click', () => {
    _adminListView = 'index';
    openModal('adminModal');
    switchAdminTab('lists');
  });
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('tq_token');
    currentUser = null;
    renderAuthUI();
    showToast('Signed out');
    route(location.pathname);
  });

  /* modal switch links */
  document.getElementById('switchToRegister')?.addEventListener('click', e => {
    e.preventDefault(); closeModal('loginModal'); openModal('registerModal');
  });
  document.getElementById('switchToLogin')?.addEventListener('click', e => {
    e.preventDefault(); closeModal('registerModal'); openModal('loginModal');
  });

  /* login form */
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');
    try {
      const data = await api.post('/api/auth/login', {
        email:    document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      });
      localStorage.setItem('tq_token', data.token);
      initAuth();
      renderAuthUI();
      closeModal('loginModal');
      showToast('Welcome back, ' + (currentUser.username || currentUser.email) + '!');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  /* register form */
  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('registerError');
    errEl.classList.add('hidden');
    try {
      const data = await api.post('/api/auth/register', {
        username: document.getElementById('regUsername').value.trim(),
        email:    document.getElementById('regEmail').value.trim(),
        password: document.getElementById('regPassword').value,
      });
      localStorage.setItem('tq_token', data.token);
      initAuth();
      renderAuthUI();
      closeModal('registerModal');
      showToast('Welcome to The Quarter, ' + (currentUser.username || currentUser.email) + '!');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  /* initial route */
  route(location.pathname);
  updateNavActive(location.pathname);
});
