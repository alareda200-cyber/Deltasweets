# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# The build's own server/package.json lists the only runtime dependency
# actually needed (Nitro bundles everything else into the .output chunks).
COPY --from=builder /app/.output ./.output
RUN cd .output/server && npm install --omit=dev

# Cloud Run injects PORT at runtime (defaults to 8080) — the Nitro node
# preset server already reads process.env.PORT, confirmed by direct testing
# earlier in this project's verification (started it locally with a custom
# PORT and it bound correctly).
ENV PORT=8080
EXPOSE 8080

CMD ["node", ".output/server/index.mjs"]
