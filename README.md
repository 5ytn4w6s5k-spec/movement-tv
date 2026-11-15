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

## How it works

- `app/src/main/assets/web/` holds the screens (HTML, CSS, JavaScript).
- The Android app serves those files as if they were part of skool.com, so they can read your programs with your normal Skool sign-in. Videos play through Skool's own YouTube and Vimeo links.
- Progress comes from Skool. Pressing Done marks the lesson complete on Skool itself, so it shows up on the phone app and website too.
- Every push to `main` builds a new `MovementSkool.apk` and publishes it as the latest release.
