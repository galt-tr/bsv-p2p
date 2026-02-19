# HEARTBEAT.md

## Team Status Report (every heartbeat)
1. Fetch tasks: `curl -s http://localhost:3333/api/tasks`
2. Fetch team: `curl -s http://localhost:3333/api/team`
3. Summarize what changed since last check:
   - Tasks moved to done (who completed what)
   - Tasks currently in-progress (who's working on what)
   - New tasks added
   - Any blockers
4. Send Dylan a brief status update via Telegram if anything interesting happened
5. If nothing changed, skip the update (don't spam)

## My Own Task Check
1. Look for tasks assigned to "Ghanima" in "todo" status
2. Pick the highest-priority one and work on it
3. Move to in-progress before starting, done when finished

## Also Check (rotate, 2-4x/day)
- Emails (if gog configured)
- Calendar events in next 24h
