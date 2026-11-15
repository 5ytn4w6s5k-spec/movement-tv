# Movement Skool for Chrome

The same screens as the Firestick app, in a Chrome tab.

The cloud build copies `app.js`, `app.css` and the font from `app/src/main/assets/web/` into this folder and publishes it as `MovementSkool-Chrome.zip` with each release.

## Install

1. Download `MovementSkool-Chrome.zip` from the latest release and unzip it.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped `MovementSkool-Chrome` folder.
4. Click **Details** on the Movement Skool card and turn on **Allow User Scripts**, then click the reload arrow on the card.
5. Pin **Movement Skool** from the puzzle-piece menu, then click it to open the app. You need to be signed in to Skool in Chrome.

With Allow User Scripts on, the extension loads the latest screens from this repo when Chrome starts, every 30 minutes, and each time you click its button, so changes to the screens show up without reinstalling. Without it, the extension uses the copy built into it and shows a reminder on the home screen.

Changes to the extension itself (`manifest.json`, `background.js`, `boot.js`) still need the new zip: replace the folder's contents and click the reload arrow on the extension's card.
