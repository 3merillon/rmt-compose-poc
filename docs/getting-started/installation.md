# Open the app or run it locally

The [hosted app](https://www.rmt.world/) runs in your browser. Allow sound by pressing **Play**. The workspace requires WebGL2. If the canvas stays blank, check that the browser can create a WebGL2 context and that graphics acceleration is enabled.

## Local installation

Install Git and Node.js (20.19+ on the 20.x line, or 22.12+). From a terminal run the following commands.

```sh
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
npm ci
npm run dev
```

Open the address printed by Vite, normally `http://localhost:3000`. To choose a different port, run `npm run dev -- --port 3005 --strictPort`. The app stores your session per browser origin. Export a module file to move a composition between ports or devices.

[Make your first musical change](/getting-started/first-composition) or [build and preview the production app and docs](/developer/contributing/build-and-deploy).
