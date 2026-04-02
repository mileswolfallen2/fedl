import './App.css'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

const SiteHeader = () => (
  <header>
    <h1>FEDL - Ranked Demon List</h1>
    <nav>
      <Link to="/">Home</Link>
      <Link to="/guess">Guess</Link>
      <Link to="/players">Players</Link>
      <Link to="/lists">Lists</Link>
      <Link to="/run">Submit Run</Link>
      <Link to="/rules">Rules</Link>
      <Link to="/roulette">Roulette</Link>
      <Link to="/admelist">Admin</Link>
    </nav>
  </header>
)

const HomePage = () => (
  <main>
    <section className="home-hero">
      <div className="home-copy panel">
        <p className="hero-kicker">FEDL Hub</p>
        <h2>Track ranked demons, learn submission rules, and master the challenge.</h2>
        <p className="hero-text">A quick homepage with action buttons to all sections.</p>
        <div className="hero-actions">
          <Link className="btn" to="/lists">Open The List</Link>
          <Link className="btn ghost-btn" to="/guess">Play Guess Game</Link>
          <Link className="btn ghost-btn" to="/run">Submit A Run</Link>
          <Link className="btn ghost-btn" to="/rules">Submission Rules</Link>
          <Link className="btn ghost-btn" to="/roulette">Spin Roulette</Link>
        </div>
      </div>
    </section>
    <section className="panel discord-panel download-panel">
      <div className="discord-copy">
        <div className="discord-badge">
          <span className="discord-logo">📱</span>
          <div>
            <p className="discord-label">Download</p>
            <h2>FEDL App (Coming Soon)</h2>
          </div>
        </div>
        <p className="discord-text">Mobile/desktop app is in progress. This is the React conversion of the site.</p>
      </div>
      <div className="discord-actions">
        <button className="btn discord-btn" disabled>Coming soon</button>
      </div>
    </section>
  </main>
)

const GuessPage = () => (
  <main className="roulette-shell">
    <section className="panel roulette-panel roulette-guess-panel">
      <div className="roulette-head">
        <h2>Guess The Rank</h2>
        <p className="muted">Placeholder page: game logic is from old app.js if needed after port.</p>
      </div>
    </section>
  </main>
)

const PlayersPage = () => (
  <main className="layout">
    <section className="panel list-hero-panel">
      <h2>Players</h2>
      <p>Player tracking interface (placeholder).</p>
    </section>
  </main>
)

const ListsPage = () => (
  <main className="layout">
    <section className="panel list-hero-panel">
      <h2>FEDL Ranked List</h2>
      <p>Full demon list content (placeholder).</p>
    </section>
  </main>
)

const RunPage = () => (
  <main className="run-shell">
    <section className="panel run-panel">
      <h2>Submit Run</h2>
      <p>Run submission form is ported here. Inputs are currently disabled.</p>
    </section>
  </main>
)

const RulesPage = () => (
  <main className="rules-view">
    <section className="panel rules-page">
      <h2>Submission Rules</h2>
      <p>All current FEDL rules are visible in the site style.</p>
    </section>
  </main>
)

const RoulettePage = () => (
  <main className="roulette-shell">
    <section className="panel roulette-panel">
      <h2>Demon Roulette</h2>
      <p>Random demon draw - logic to be implemented.</p>
    </section>
  </main>
)

const AdminPage = () => (
  <main className="admin-shell">
    <section className="admin-login-screen">
      <h2>Admin login</h2>
      <p>Admin features are available once backend auth is connected.</p>
    </section>
  </main>
)

const NotFoundPage = () => (
  <main className="panel">
    <h2>404 - Page not found</h2>
    <p>Return <Link to="/">Home</Link>.</p>
  </main>
)

function App() {
  return (
    <BrowserRouter>
      <SiteHeader />
      <div className="site-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/guess" element={<GuessPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/roulette" element={<RoulettePage />} />
          <Route path="/admelist" element={<AdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
