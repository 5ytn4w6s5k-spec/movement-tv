# Movement Skool for Firestick

A Fire TV app for The Movement Skool. It signs in to Skool once, then shows every program as a card. Pick a program to see its days, pick a day to get a scrolling list of that day's exercises with the coach's notes (sets, reps, cues) next to each video. Play any exercise full screen, and press Done to mark it complete on Skool.

## Install on the Firestick

1. Install **Downloader** from the Fire TV app store.
2. Settings → My Fire TV → Developer Options → Install unknown apps → turn on for Downloader.
3. In Downloader, enter the download link for `MovementSkool.apk` from this repo's latest release and install it.
4. Open **Movement Skool** from Your Apps & Channels and sign in to Skool.

## Remote

| Button | On a list | While a video plays |
| --- | --- | --- |
| Arrows | Move around | Left/right: back or ahead 10 seconds |
| OK | Open, play, or press Done | Pause or play |
| Rewind / fast-forward | | Back or ahead 10 seconds |
| Back | Go back a screen | Back to the exercise list |

## On a laptop (Chrome)

The `chrome-extension/` folder is the same app as a Chrome extension. Each release includes `MovementSkool-Chrome.zip`; see `chrome-extension/README.md` to install it.

## How it works

- `app/src/main/assets/web/` holds the screens (HTML, CSS, JavaScript).
- The Android app serves those files as if they were part of skool.com, so they can read your programs with your normal Skool sign-in. Videos play through Skool's own YouTube and Vimeo links.
- Progress comes from Skool. Pressing Done marks the lesson complete on Skool itself, so it shows up on the phone app and website too.
- The app loads its screens from the latest version of `app/src/main/assets/web/` in this repo each time it opens (and after it's been in the background for a while), so changes to the screens show up without reinstalling. It keeps the last version it loaded for when the internet is down, and falls back to the copy built into the app.
- Changes to the Android side (`MainActivity.java`, the manifest, the icon and banner) need a reinstall. Raise `SHELL_VERSION` in `MainActivity.java` and `SHELL_LATEST` in `app.js` together, and the app shows a reinstall note until it's updated.
- Every push to `main` builds a new `MovementSkool.apk` and publishes it as the latest release.
