# NFL Edge

Static site for NFL parlay research and fantasy matchups. Data refreshes itself.

- **Games**: model score, win/cover/over probabilities, edge vs. consensus line, Hard Rock price boxes.
- **Parlay Lab**: slip builder (combined probability, payout, EV) + auto-suggested parlays.
- **Fantasy**: weekly projections (PPR/half/std), matchup grades, start/sit, TD chances.
- **My Team**: save your fantasy roster(s) (search, or paste from ESPN/Yahoo/Sleeper), set scoring and lineup slots, and get the best lineup automatically, with bench reasoning, toss-ups and locks. Covers QB/RB/WR/TE/FLEX/SUPERFLEX plus kickers and defenses.
- **Prop Checker**: enter a Hard Rock prop line/price, get over/under probability and EV.
- **Record**: picks are logged before kickoff and graded after, so the track record is honest.

## Run locally
    npm run refresh   # pulls nflverse data -> public/data/*.json
    npm run serve     # http://localhost:5173
    npm test

## Self-updating
`.github/workflows/refresh.yml` runs every 3 hours: refresh, commit changed data, redeploy to GitHub Pages.
Setup: push to GitHub, then Settings -> Pages -> Source: "GitHub Actions". That's it.
The script figures out the current week from the schedule, so bye weeks, Thursday/Monday games,
playoffs and the next season need no changes. Offseason: it uses last season's data until games are played.

## Notes
- Lines are nflverse consensus lines, not Hard Rock's (no free public feed exists). Type Hard Rock's price
  into the "HR" boxes; these are stored in the browser only.
- Entertainment/research only, not betting advice.
