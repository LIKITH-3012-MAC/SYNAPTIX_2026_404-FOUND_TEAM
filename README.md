# ⚖️ RESOLVIT — Civic Resolution Platform

> **"From Complaint to Completion."**  
> AI-powered civic issue tracking with real-time priority scoring, blockchain audit trails, and authority performance accountability.

---

## 🚀 Quick Start

### Option A: Docker (Recommended — Full Stack)

```bash
cd /path/to/resolvit
docker-compose up -d
```

| Frontend | http://localhost:3000            |
| API      | http://localhost:8000/api/docs  |
| Auth     | Auth0 + PostgreSQL Sync         |

---

## 🛡️ Authentication Architecture (NEW)

The platform has migrated to a hybrid **Auth0 + Local Security** model:
- **Google OAuth 2.0**: Official government-grade identity verification.
- **GitHub**: Integrated developer/authority login portal.
- **Enterprise Database**: Secure local PostgreSQL fallback.
- **Session Management**: JWT-based stateless security with transparent redirect flows.

---

### Option B: Manual Setup (Development)

#### 1. Database

```bash
# Start PostgreSQL (requires PostgreSQL 15+)
createdb resolvit
psql resolvit < database/schema.sql
psql resolvit < database/seed.sql
```

#### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Configure environment
cp .env .env.local
# Edit .env.local with your DATABASE_URL and SECRET_KEY

uvicorn app:app --reload --port 8000
```

#### 3. Frontend

```bash
# Simply open in browser (no build step needed)
open frontend/index.html

# Or serve locally:
cd frontend
python -m http.server 3000
# Then visit: http://localhost:3000
```

---

## 🔐 Demo Credentials

| Role      | Email                         | Password     |
|-----------|-------------------------------|--------------|
| Admin     | admin@resolvit.gov            | Password123! |
| Authority | roads@resolvit.gov            | Password123! |
| Authority | water@resolvit.gov            | Password123! |
| Authority | electricity@resolvit.gov      | Password123! |
| Citizen   | citizen1@example.com          | Password123! |
| Citizen   | citizen2@example.com          | Password123! |

---

## 🏗 Project Structure

```
/resolvit
  /backend
    app.py                  ← FastAPI entry point + CORS + scheduler
    auth.py                 ← JWT auth + bcrypt password hashing
    database.py             ← PostgreSQL connection pool
    models.py               ← Pydantic request/response schemas
    Dockerfile
    requirements.txt
    .env                    ← Environment config (copy this)
    /routes
      auth_routes.py        ← POST /api/auth/register, /login, /me
      issues.py             ← CRUD /api/issues
      audit_metrics.py      ← GET /api/audit/{id}, /api/metrics/*
    /services
      clustering.py         ← AI clustering (Haversine + Jaccard NLP)
      priority.py           ← Dynamic priority scoring engine
      escalation.py         ← Background SLA enforcement + auto-escalation
      blockchain.py         ← SHA-256 chained immutable audit log
  /frontend
    index.html              ← Landing page (hero, counters, map)
    submit.html             ← Submit issue (sliders, map pin, priority preview)
    dashboard.html          ← Public feed (filters, sort, live map)
    issue.html              ← Issue detail (timeline, timer, audit chain)
    authority.html          ← Authority dashboard (leaderboard, SLA alerts)
    /css
      styles.css            ← 1000+ line design system
    /js
      api.js                ← Fetch wrapper + toast notifications
      auth.js               ← Login/register/session management
      issues.js             ← Issue card renderer + CRUD helpers
      dashboard.js          ← Polling, filtering, map, sorting
      animations.js         ← Counters, ripple, scroll animations
  /database
    schema.sql              ← PostgreSQL schema (6 tables, indexed)
    seed.sql                ← Demo data (users, issues, escalations)
  docker-compose.yml
  nginx.conf
  README.md
```

---

## 📡 API Documentation

Interactive docs: **http://localhost:8000/api/docs** (Swagger UI)

### Authentication

| Method | Endpoint              | Description       | Auth Required |
|--------|-----------------------|-------------------|---------------|
| POST   | /api/auth/register    | Create account    | No            |
| POST   | /api/auth/login       | Login + get JWT   | No            |
| GET    | /api/auth/me          | Get current user  | Yes           |

### Issues

| Method | Endpoint              | Description                      | Auth Required |
|--------|-----------------------|----------------------------------|---------------|
| POST   | /api/issues           | Create issue (triggers AI + audit)| Yes          |
| GET    | /api/issues           | List all issues (filter, sort, page)| No         |
| GET    | /api/issues/{id}      | Get issue details                | No            |
| PATCH  | /api/issues/{id}      | Update issue status/note         | Yes           |
| DELETE | /api/issues/{id}      | Delete issue                     | Admin only    |

**Query Parameters for GET /api/issues:**
- `category` — Roads, Water, Electricity, Sanitation, Safety, Environment, Other
- `status` — reported, verified, clustered, assigned, in_progress, escalated, resolved
- `sort_by` — priority_score (default), created_at, impact_scale, urgency
- `order` — desc (default), asc
- `limit` — max 200 (default 50)
- `offset` — pagination offset

### Audit & Metrics

| Method | Endpoint                  | Description                |
|--------|---------------------------|----------------------------|
| GET    | /api/audit/{issue_id}     | Full blockchain audit chain|
| GET    | /api/metrics/leaderboard  | Authority performance table|
| GET    | /api/metrics/summary      | Platform-wide stats        |

---

## 🧠 AI Features

### Clustering Engine
- Detects issues within **100m radius** (Haversine formula)
- Computes **Jaccard title similarity** (NLP, no ML dependency)
- Merges duplicates → amplifies `impact_scale` on representative issue
- Auto-recalculates priority after merge

### Priority Scoring Formula
```
priority_score =
  (impact_scale          / 1000) × 100 × 0.40
+ (urgency               / 5)    × 100 × 0.30
+ (days_unresolved       / 30)   × 100 × 0.20
+ (safety_risk_probability)      × 100 × 0.10

Score range: 0–100
```

### Escalation Engine
- Runs **every hour** via APScheduler
- Auto-escalates issues unresolved > 7 days (configurable via `ESCALATION_DAYS` env)
- Creates escalation event + updates blockchain audit log

### Blockchain Audit
- SHA-256 hash of `(previous_hash + payload)` — append-only chain
- Each event (create, update, escalate, resolve) is an immutable block
- Chain integrity verifiable via `GET /api/audit/{id}`

### 🖥️ High-Fidelity Responsive Engine (v2.5)
- **Mobile-First Core**: 100% horizontal scroll-free experience on all devices (320px+).
- **Fluid Typography**: Dynamic `clamp()`-based scaling for elite readability.
- **Cinematic Landing**: Isolated landing background to `index.html` for maximum performance on portal pages.
- **Responsive Tables**: Governance reports and audit logs utilize a mobile-scrolling engine.

### 📄 Document Intelligence — Exports
- **Real-Time PDF Generation**: Instant professional resolution reports.
- **CSV Data Streaming**: Full civic data exports for transparency.

---

## 🔒 Security

- **bcrypt** password hashing (12 rounds)
- **JWT HS256** tokens with 24h expiry
- **Role-based access**: citizen / authority / admin
- **Input validation** via Pydantic schemas
- **XSS protection** via HTML escaping in frontend JS
- **CORS** configured per environment

---

## ⚙️ Environment Variables

```env
DATABASE_URL=postgresql://resolvit:resolvit123@localhost:5432/resolvit
SECRET_KEY=your-secret-key-change-in-production
ACCESS_TOKEN_EXPIRE_HOURS=24
ESCALATION_DAYS=7
CORS_ORIGINS=http://localhost:3000
PORT=8000
```

---

## 🗺 Roadmap

| Phase | Feature |
|-------|---------|
| ✅ 1 | Core MVP — auth, issues, AI clustering, priority, audit |
| ✅ 2 | Auth0 Integration (Google/GitHub), Responsive Portal v2.5 |
| ✅ 3 | Cinematic Landing isolation & Performance Optimization |
| ✅ 4 | PDF/CSV Export System Implementation |
| 🔜 5 | WebSocket real-time updates, Redis caching |
| 🔜 6 | ML severity classifier, smart heatmap |
| 🔜 7 | Mobile app (React Native), SMS notifications |

---

## 🧑‍💻 Built With

- **Backend**: Python, FastAPI, psycopg2, APScheduler, python-jose, passlib
- **Frontend**: Vanilla HTML + CSS + JavaScript, Leaflet.js
- **Database**: PostgreSQL 15
- **Infrastructure**: Docker, Nginx

---

*RESOLVIT — Accountability at Scale. Built for the citizens of India.*
"# RESOLVIT" 
