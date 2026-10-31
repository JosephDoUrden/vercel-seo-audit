# Renders docs/demo.gif. Needs vhs (https://github.com/charmbracelet/vhs) and a built dist/.
#   npm run build && vhs docs/demo.tape
Output docs/demo.gif

Set Shell zsh
Set FontSize 14
Set Width 1000
Set Height 720
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

Hide
Type "alias vercel-seo-audit='node bin/vercel-seo-audit.js'"
Enter
Type "clear"
Enter
Show

Sleep 500ms
Type "vercel-seo-audit https://yusufhan.dev --only redirects,sitemap,structuredData,vercel,streamedMetadata"
Sleep 400ms
Enter
Sleep 6s
