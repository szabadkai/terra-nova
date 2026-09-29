# A browser in a LAN of the lab: Debian's Chromium (it bundles SwiftShader, so WebGL 2 works without a GPU)
# driven by scripts/nettest.mjs (built from scripts/ as the context).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium iproute2 ca-certificates fonts-dejavu-core tcpdump && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm init -y >/dev/null && npm i puppeteer-core@25 >/dev/null 2>&1
COPY nettest.mjs /app/nettest.mjs
