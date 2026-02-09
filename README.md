# Affix

**AI-powered Business Intelligence platform with natural language data exploration**

Affix transforms how teams explore their data. Upload any CSV or Excel file, ask questions in plain English, and get instant visualizations with AI-generated insights.

## Features

- **Natural Language Queries**: Ask questions like "What is our revenue by region?" and get instant charts
- **AI-Generated Insights**: Automatic anomaly detection, trend analysis, and actionable recommendations
- **Beautiful Dashboards**: Drag-and-drop dashboard builder with auto-save
- **Background Analysis**: Autonomous AI exploration of your entire dataset
- **Team Collaboration**: Multi-tenant architecture with role-based access control
- **Public Sharing**: Share dashboards via public links or embed in other sites
- **Data Relationships**: Auto-detect foreign key relationships between tables
- **Project Templates**: Pre-configured templates for Sales, Inventory, Customer Intelligence, and more

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express.js |
| Database | SQLite (better-sqlite3) |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) |
| Frontend | Vanilla JS + ECharts |
| Styling | CSS Variables with dark luxury theme |

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/davidmodfyi/useaffix.ai.git
cd affix

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start the server
npm start
```

The server runs at:
- Main site: http://localhost:3000
- App dashboard: http://localhost:3000/app
- Login: http://localhost:3000/login

### Default Login

On first run, a default user is created:
- Email: `demo@useaffix.ai`
- Password: `demo123`

(Configure via `DEFAULT_USER_EMAIL`, `DEFAULT_USER_PASSWORD`, `DEFAULT_USER_NAME` environment variables)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | development | Set to `production` for secure cookies |
| `PORT` | No | 3000 | Server port |
| `SESSION_SECRET` | Yes* | Generated | Session signing secret |
| `ANTHROPIC_API_KEY` | Yes | - | Claude API key for NL queries |
| `PERSISTENT_DISK_PATH` | No | /var/data | Base path for persistent storage |
| `DEFAULT_USER_EMAIL` | No | - | Email for seed user |
| `DEFAULT_USER_PASSWORD` | No | - | Password for seed user |
| `DEFAULT_USER_NAME` | No | - | Name for seed user |

*Auto-generated in development, but should be set in production for session persistence.

## Architecture

```
affix/
├── index.js                    # Express server with all API routes
├── db/
│   ├── init.js                 # SQLite schema and migrations
│   └── seed.js                 # Default user seeding
├── lib/
│   ├── nlquery.js              # Claude AI integration for NL queries
│   ├── insights.js             # AI-generated insight detection
│   ├── backgroundAnalysis.js   # Autonomous data exploration
│   ├── dashboardGenerator.js   # AI dashboard auto-generation
│   ├── projectTemplates.js     # Pre-built project templates
│   ├── queryCache.js           # Query result caching
│   ├── rateLimit.js            # API rate limiting
│   ├── relationshipDetector.js # FK relationship detection
│   ├── webhookDelivery.js      # Outgoing webhook integration
│   ├── api-usage.js            # Credit/usage tracking
│   └── datasources/            # Data source abstractions
│       ├── DataSource.js       # Abstract interface
│       └── FileDataSource.js   # SQLite implementation
├── middleware/
│   ├── auth.js                 # Authentication & authorization
│   └── session-store.js        # SQLite session storage
├── views/
│   ├── app.html                # Main SPA dashboard
│   └── login.html              # Login page
└── data/                       # Tenant data files (dev)
    └── tenants/{tenantId}/data.db
```

## API Endpoints

### Authentication
- `POST /auth/login` - Authenticate user
- `POST /auth/logout` - End session
- `GET /auth/me` - Get current user

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `POST /api/projects/:id/upload` - Upload data file
- `POST /api/projects/:id/query` - Ask NL question
- `GET /api/projects/:id/queries` - Query history

### Dashboards
- `GET /api/projects/:id/dashboards` - List dashboards
- `POST /api/projects/:id/dashboards` - Create dashboard
- `POST /api/projects/:id/generate-dashboard` - AI-generate dashboard
- `PUT /api/dashboards/:id/share` - Toggle public sharing

### Background Analysis
- `POST /api/projects/:id/background-analysis` - Start analysis
- `GET /api/background-jobs/:id` - Get job status
- `POST /api/background-jobs/:id/cancel` - Cancel job

### Team Management
- `GET /api/team` - List team members
- `POST /api/team/invite` - Add team member
- `PUT /api/team/:userId/role` - Change role
- `DELETE /api/team/:userId` - Remove member

See `CLAUDE.md` for complete API documentation.

## Credits & Usage

Affix tracks API usage to help manage costs:
- Each query consumes Claude API tokens
- Background analysis has configurable credit budgets
- Usage is tracked per tenant per month
- Credit summaries available via `GET /api/credits`

## Security

- Session-based authentication with bcrypt password hashing
- Helmet.js security headers with CSP
- SQL injection prevention with parameterized queries and validation
- Tenant isolation on all API endpoints
- Rate limiting (30 queries/min, 3 concurrent background jobs)
- File upload validation with magic byte checking

## Deployment

### Render (Recommended)

1. Push to GitHub
2. Connect repo to Render
3. Set environment variables
4. Use persistent disk at `/var/data`

Auto-deploys on push to main.

### Docker

```dockerfile
FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## License

Proprietary - All rights reserved.

## Support

- GitHub Issues: https://github.com/davidmodfyi/useaffix.ai/issues
- Documentation: See `CLAUDE.md` for detailed technical docs

---

Built with AI by [Affix](https://useaffix.ai)
