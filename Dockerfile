
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg python3 python3-venv build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir --upgrade "yt-dlp[default]"

ENV PATH="/opt/yt-dlp/bin:${PATH}"

RUN npm install -g deno

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/state

CMD ["npm", "start"]
