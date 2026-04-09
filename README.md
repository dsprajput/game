# Four of a Kind

A browser card game with:

- local multiplayer on one device
- `1 player vs 3 computers`
- online rooms with invite links

## Production baseline

This version is hardened beyond a prototype:

- persistent room storage with SQLite
- reconnectable player sessions using server-issued tokens
- room cleanup for stale waiting/finished games
- basic request rate limiting
- health endpoint for deployment platforms

## Run locally

```bash
python3 server.py
```

Then open `http://localhost:8000`.

## Deploy

This project is set up for single-instance deployment on platforms like Render.

Important:

- keep the app on a single instance
- mount persistent disk storage so `game.db` survives restarts
- terminate HTTPS at the hosting platform or reverse proxy

## Current limits

This is suitable for a real public launch on one server, but not yet for high-scale multi-instance hosting.

To scale further, the next step would be:

- Postgres instead of SQLite
- WebSockets instead of polling
- stronger abuse controls and observability
