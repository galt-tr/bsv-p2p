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

## Calendar Alerts
1. Fetch events: `curl -s http://localhost:3333/api/events`
2. If `gog` is authenticated, also fetch Google Calendar events and sync to Mission Control
3. If any event starts within 60 minutes, alert Dylan via Telegram: "📅 Reminder: [Title] starts in [X] minutes"
4. Track alerted events in `memory/alerted-events.json` to avoid duplicates
5. Morning summary (8-9 AM): send Dylan his day's schedule if there are events

## Also Check (rotate, 2-4x/day)
- Emails (if gog configured)
