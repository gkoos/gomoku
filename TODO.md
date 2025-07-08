# TODO

This is the markdown todo file for project gomoku.

## UI

## AI
- [ ] Handle forks better.
- [ ] Implement pondering (ie. the AI should continue thinking even when the opponent is making a move).

## Refactor
- [ ] Refactor AI code to use a more modular approach and make ES6 syntax work in vite for webworkers both in dev and prod build.

## New Features
- [ ] Rename Hard difficulty to Pro and add a new Hard difficulty level between Medium and Pro.

# DONE
- [x] Fix responsive design for mobile devices.
- [x] Add a board editor to allow users to create game positions.
- [x] AI shouldn't skip deep search for closed 4's - Fixed by checking if blocked patterns can actually extend to win
