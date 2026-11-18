# Mobile layout verification

Run `npm run test:mobile:fullscreen` on Windows with Chrome installed. The test
starts a local server with a separate temporary database, exercises the landing
page and Classic/Flip/No Mercy setup, lobby and gameplay, and writes screenshots
to `scratch/mobile-fullscreen`.

Checks cover 320x568, 390x844, 844x390 and 932x430, horizontal overflow,
table/hand collisions, 25-card and six-player renderer fixtures, dialog bounds,
and overlays clearing after leaving. Fullscreen event states are simulated:
headless mobile Chromium rejects native fullscreen. These checks do not prove
native Android/iOS fullscreen behavior, browser toolbar transitions, safe-area
insets on a notched device, or a real software keyboard. Those need device QA.

The implementation uses current viewport metrics for the playing surface and
visible viewport height for dialogs, preserves orientation on fullscreen entry,
and allows long setup/lobby content to scroll without clipping controls.
Desktop branding and victory-fit browser regression checks also passed.
