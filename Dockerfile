FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY script.js ./
COPY style.css ./

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]
