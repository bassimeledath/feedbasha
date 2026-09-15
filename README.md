<h1><img src="assets/karen-wordmark.svg" alt="Karen" width="356" height="128"></h1>

**App feedback as easy as complaining.**

Point at something in your app. Say what should change. Karen packages your feedback with component names, source locations, and optional region screenshots—ready to paste into your coding agent.

A development-only overlay for React apps. You bring the opinions and Karen turns it into usable context for your coding agent.

## See her in action

🔊 **Sound on.** This demo includes spoken feedback.

https://github.com/user-attachments/assets/9af14392-70aa-4a89-9807-67b8197e58a0

## The feedback loop

1. **Point.** Click a component or drag over a region.
2. **Speak.** Say what's off. Edit the transcript, or type instead.
3. **Hand it over.** Review, copy feedback, and paste it into your local coding agent.

“That button” now comes with context. Karen doesn't edit your code; your agent does.

## Try Karen

Run the included demo locally (Node.js 20.19+; Chrome for browser voice):

```bash
git clone https://github.com/bassimeledath/karen.git
cd karen
npm install
npm install --prefix examples/basic
npm run dev --prefix examples/basic
```

Open the localhost URL, click Karen, and select something to give feedback on. Allow microphone access when prompted.

**Bring her to your app:** [React + Vite setup, screenshots, and Electron voice →](INTEGRATION.md)

## A few boundaries

- **For development, not production.** React source metadata is available when the development tooling exposes it.
- **Your agent needs the files.** Region screenshots are optional; the included demo saves them locally and copies their paths, not the image pixels. The coding agent needs access to that same filesystem.
- **Voice isn't always offline.** Browser speech may send audio to the browser's speech service. An optional Whisper provider supports local transcription after its model downloads. Text works without a microphone.
- **No npm release yet.** The Git repository is `karen`; the package/import is still `feedbasha`. Don't run `npm install feedbasha`—that's an unrelated npm package.

## Built with

[React Grab](https://github.com/aidenybai/react-grab) powers Karen's component and source-location lookup. Karen adds voice and text notes, region capture, review, and the feedback handoff. Thanks to Aiden Bai and the React Grab contributors.

Found something that deserves a word? [Open an issue](https://github.com/bassimeledath/karen/issues).

MIT · [Integration reference](INTEGRATION.md) · [Example app](examples/basic)
