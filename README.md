# crabble 🦀

A bilingual (English / 中文) drawing-and-guessing game for the classroom — like skribbl.io, but every word is an English/Chinese pair and **either language counts as a correct guess**. Built for up to 16 players on 11-inch Chromebooks.

## How the bilingual guessing works

Every word is a pair like **cat · 猫**. During a round, any of these count as correct:

- the English word — `cat` (case and extra spaces don't matter)
- the Chinese word — `猫`
- pinyin, with or without tones — `mao`, `māo`, or `mao1` (so kids without a Chinese keyboard can still answer in Chinese)

Hints appear as the timer runs down: blanks for the English word (`_ _ _`) and one box per Chinese character (`□`).

## Run it locally

```bash
pnpm install
pnpm start          # → http://localhost:3000
```

Open the page, enter a name, click **Create a room 创建房间**, then share the invite link (or the 4-letter code) with the class.

## Your own vocabulary

When creating a room you can:

- pick from 8 built-in categories (~200 kid-friendly word pairs), and/or
- paste your own list, one word per line:

  ```
  english,中文
  english,中文,pinyin      ← pinyin is optional; it's generated automatically
  ```

  Commas can be half-width `,` or full-width `，`; tabs work too (so you can paste straight from a spreadsheet).

To permanently add words for every game, edit `server/data/words.json` and redeploy.

## Deploy for free (Render)

1. Push this folder to a GitHub repository:
   ```bash
   git init && git add -A && git commit -m "crabble"
   # create a repo on github.com, then:
   git remote add origin https://github.com/<you>/crabble.git
   git push -u origin main
   ```
2. On [render.com](https://render.com), choose **New → Web Service**, connect the repo. Render reads `render.yaml` automatically — no other settings needed.
3. Share the `https://crabble-….onrender.com` URL with the class.

**Free-tier note:** the server sleeps after ~15 minutes with no visitors and takes ~30–60 seconds to wake up. Open the site a few minutes before class starts and it'll be instant for the kids. A restart also ends any game in progress (scores live in memory) — everyone just rejoins.

A `Dockerfile` is included in case you ever want to host it elsewhere.

## Classroom tips

- Kids join fastest via the invite link (**📋 Copy invite link** in the room lobby) — project it as a QR code if you like.
- The room creator is the host 👑: only they can start the game or remove a player (❌ next to a name).
- If a Chromebook drops off the Wi-Fi or reloads the page, the player rejoins automatically with their score intact.

## Tests

`node sim.test.mjs` (with the server running) simulates a full 3-player game: joining, drawing sync, all four guess forms, reconnection, and scoring.
