FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
# scripts skipped: postinstall runs prisma generate, which needs the schema copied below
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main"]
