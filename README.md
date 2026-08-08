# Tier List Maker

Simple tier list maker with per-user accounts, saved lists, drag-and-drop tiers, image tiles, and Deezer album search.

## Features

- Email/password registration and login
- Secure session-based auth
- Multiple saved tier lists per user
- Drag-and-drop tier editing
- Text tiles and Deezer album tiles
- PNG export

## Run locally

```bash
docker compose up -d --build
```

## Dev workflow

- Frontend: VS Code Live Server on `http://127.0.0.1:5500`
- Backend/API: Docker container on `http://127.0.0.1:3002`

## Notes

- Uses ES modules
- Uses Yarn
- Stores app data in SQLite under `data/`