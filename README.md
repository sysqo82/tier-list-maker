# Tier List Maker

Rank anything – albums, films, snacks, you name it – by dragging it into tiers from best to worst (S, A, B, C… or whatever tiers you like).

## What you can do

- **Create an account** and keep as many tier lists as you want, all saved for next time.
- **Set up your tiers** – add new ones, rename them and choose their colours.
- **Add things to rank:**
  - type in a name,
  - upload your own pictures, or
  - search for an album and its cover art is added for you.
- **Drag and drop** items between tiers until you're happy.
- **Download your list as a picture** (PNG) to share.

## How it's built

- **Front end:** plain **HTML**, **CSS** and **JavaScript** (`index.html`, `app.js`, plus separate login and registration pages).
- **Back end:** a small **Node.js / Express** server (`server.js`) that handles accounts, saves your lists and searches **Deezer** for albums.
- **Saving:** a **SQLite** database stored in the `data` folder.
- **Logins:** email and password, kept signed in with a secure session.
- **Packaging:** **Docker**.

## Running it yourself

You'll need **Docker**. In this folder, run:

```bash
docker compose up -d --build
```

The server runs on port **3002**. Your lists are kept in the `data` folder, so they survive restarts.

**While working on it:** run the back end in Docker as above, and open the front end with VS Code's Live Server (`http://127.0.0.1:5500`).
