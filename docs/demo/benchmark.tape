# Records docs/demo/benchmark.gif from a real run: `vhs docs/demo/benchmark.tape` from the repo root.
Output docs/demo/benchmark.gif
Set Shell "bash"
Set FontSize 15
Set Width 1300
Set Height 460
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 22ms

Hide
Type `export PS1='$ ' && npm ci --silent && npm run -s build && clear` Enter
Sleep 45s
Show
Type `npm run -s benchmark` Enter
Sleep 10s
