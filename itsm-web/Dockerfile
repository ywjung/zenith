FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_GITLAB_URL
ENV NEXT_PUBLIC_GITLAB_URL=$NEXT_PUBLIC_GITLAB_URL
RUN npm run build && test -d .next/standalone && test -d .next/static

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -H -D appuser
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health 2>/dev/null | grep -q . || wget -qO- http://localhost:3000 > /dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
