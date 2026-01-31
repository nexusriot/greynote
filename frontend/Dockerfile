FROM node:20-alpine
WORKDIR /app

# install deps during build
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# copy app sources (minimal)
COPY index.html vite.config.js ./
COPY src ./src

EXPOSE 5173
CMD ["npm","run","dev","--","--host","0.0.0.0","--port","5173"]
