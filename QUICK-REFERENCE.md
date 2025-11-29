# StageFlow Quick Reference

## Fix Claude Code (Run in Terminal)
```bash
cd ~/Desktop && chmod +x fix-claude-code.sh && ./fix-claude-code.sh
```
Then restart VS Code (Cmd+Q, then reopen)

## Open Project in VS Code
```bash
cd ~/Desktop/stageflow-app && code .
```
Or double-click `stageflow.code-workspace`

## Development Commands

### Start Local Server
```bash
npm run dev
```
Opens at http://localhost:8888

### Build for Production
```bash
npm run build
```

### Deploy to Netlify
```bash
npm run deploy:safe    # With validation
npm run deploy:force   # Without validation
```

### Testing
```bash
npm run test:all       # All tests
npm run test:e2e       # E2E tests
npm run test:e2e:ui    # E2E with UI
```

## Git Workflow
```bash
git status             # Check what changed
git add .              # Stage all changes
git commit -m "msg"    # Commit with message
git push origin main   # Push to GitHub (triggers Netlify deploy)
```

## Useful VS Code Shortcuts

### Claude Code
- `Cmd+Shift+P` → "Claude Code: Open"
- Click Claude icon in sidebar

### General
- `Cmd+P` → Quick file open
- `Cmd+Shift+F` → Search across files
- `Cmd+B` → Toggle sidebar
- `Cmd+J` → Toggle terminal
- `Cmd+Shift+E` → File explorer
- `Cmd+\`` → Terminal

### Editing
- `Cmd+/` → Comment/uncomment
- `Option+Up/Down` → Move line up/down
- `Shift+Option+Up/Down` → Copy line up/down
- `Cmd+D` → Select next occurrence

## Project Structure
```
stageflow-app/
├── src/              → React components & pages
│   ├── components/   → Reusable components
│   ├── pages/        → Page components
│   └── utils/        → Utilities
├── netlify/          → Serverless functions
│   └── functions/    → API endpoints
├── supabase/         → Database migrations
├── dist/             → Build output (ignored in Git)
└── node_modules/     → Dependencies (ignored in Git)
```

## Key Files
- `package.json` → Dependencies & scripts
- `vite.config.js` → Vite configuration
- `tailwind.config.js` → Tailwind CSS config
- `netlify.toml` → Netlify configuration
- `.env` → Environment variables (NOT in Git)

## Environment Variables
Set in Netlify Dashboard or `.env` file:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STRIPE_PUBLIC_KEY`
- `STRIPE_SECRET_KEY`

## Troubleshooting

### Claude Code not working
1. Run fix script (see top)
2. Restart VS Code
3. Check extension is enabled

### Local dev server won't start
```bash
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Build fails
```bash
npm run build -- --debug
```

### Functions not working locally
```bash
netlify dev
# (instead of npm run dev)
```

### Git push rejected
```bash
git pull origin main
# Resolve conflicts
git push origin main
```

## Need Help?
1. Check SETUP-GUIDE.md on Desktop
2. Use Claude Code in VS Code
3. Check docs:
   - Claude: docs.claude.com
   - Netlify: docs.netlify.com
   - Supabase: supabase.com/docs

---
Quick Ref Updated: November 28, 2025
